/* 09_Permisos.gs
 * Matriz de permisos: qué puede hacer cada nivel en cada módulo.
 *
 * Regla dura del sistema: el nivel ADMIN siempre tiene acceso total y no se puede
 * recortar desde la pantalla. Es lo que evita que alguien se deje a sí mismo —y a
 * todos los demás— fuera del módulo de permisos y deje el sistema sin administrador.
 */

var Permisos_ = {

  _cacheClave: 'MATRIZ_PERMISOS_V1',

  /** { NIVEL: { MODULO: { VER:true, CREAR:false, ... } } } */
  matriz: function () {
    var cache = CacheService.getScriptCache();
    var guardado = cache.get(this._cacheClave);
    if (guardado) {
      try { return JSON.parse(guardado); } catch (ignore) {}
    }

    var mods = MODULOS_();
    var m = {};
    Object.keys(NIVELES_()).forEach(function (nivel) {
      m[nivel] = {};
      Object.keys(mods).forEach(function (mod) {
        m[nivel][mod] = {};
        mods[mod].acciones.forEach(function (a) { m[nivel][mod][a] = false; });
      });
    });

    Db_.leer('PERMISO').forEach(function (r) {
      var nivel = String(r.NIVEL_ACCESO || '').toUpperCase();
      var mod = String(r.MODULO || '').toUpperCase();
      if (!m[nivel] || !m[nivel][mod]) { return; }
      if (String(r.ESTADO).toUpperCase() !== 'ACTIVO') { return; }
      mods[mod].acciones.forEach(function (a) {
        m[nivel][mod][a] = String(r[a] || 'NO').toUpperCase() === 'SI';
      });
    });

    // ADMIN: todo activado, pase lo que pase en la hoja.
    Object.keys(mods).forEach(function (mod) {
      mods[mod].acciones.forEach(function (a) { m.ADMIN[mod][a] = true; });
    });

    cache.put(this._cacheClave, JSON.stringify(m), CONFIG_().CACHE_SEG);
    return m;
  },

  invalidar: function () {
    CacheService.getScriptCache().remove(this._cacheClave);
  },

  /** Acepta un contexto de sesión o directamente el nombre del nivel. */
  _nivel: function (ctxONivel) {
    if (!ctxONivel) { return ''; }
    return String(typeof ctxONivel === 'string' ? ctxONivel : ctxONivel.nivel || '').toUpperCase();
  },

  puede: function (ctxONivel, modulo, accion) {
    var nivel = this._nivel(ctxONivel);
    if (!nivel) { return false; }
    if (NIVELES_()[nivel] && NIVELES_()[nivel].total) { return true; }
    var m = this.matriz();
    return !!(m[nivel] && m[nivel][modulo] && m[nivel][modulo][accion]);
  },

  puedeTabla: function (ctx, tabla, accion) {
    var def = ESQUEMA_()[tabla];
    if (!def) { return false; }
    if (def.soloLectura && accion !== 'VER') { return false; }
    var modulo = MODULO_DE_(tabla);
    if (!modulo) { return false; }
    return this.puede(ctx, modulo, accion);
  },

  exigir: function (ctx, modulo, accion) {
    if (this.puede(ctx, modulo, accion)) { return true; }
    Auditoria_.registrar(ctx, accion, modulo, '', '', '', '', 'DENEGADO',
      'Nivel ' + (ctx.nivel || '?') + ' sin permiso ' + accion + ' en ' + modulo);
    var etiqueta = (MODULOS_()[modulo] || {}).etiqueta || modulo;
    throw new Error('Tu nivel (' + (ctx.etiquetaNivel || ctx.nivel) + ') no tiene permiso para ' +
                    accion.toLowerCase() + ' en ' + etiqueta + '.');
  },

  exigirTabla: function (ctx, tabla, accion) {
    if (this.puedeTabla(ctx, tabla, accion)) { return true; }
    var def = ESQUEMA_()[tabla];
    Auditoria_.registrar(ctx, accion, tabla, '', '', '', '', 'DENEGADO',
      'Nivel ' + (ctx.nivel || '?') + ' sin permiso ' + accion);
    if (def && def.soloLectura && accion !== 'VER') {
      throw new Error(def.etiqueta + ' es un registro histórico: no se puede modificar.');
    }
    throw new Error('Tu nivel (' + (ctx.etiquetaNivel || ctx.nivel) + ') no tiene permiso para ' +
                    accion.toLowerCase() + ' en ' + (def ? def.etiqueta : tabla) + '.');
  },

  /** Estructura lista para pintar la pantalla de permisos. */
  paraPantalla: function (ctx) {
    this.exigir(ctx, 'PERMISOS', 'VER');
    var mods = MODULOS_();
    var niveles = NIVELES_();
    var m = this.matriz();

    return {
      niveles: Object.keys(niveles).sort(function (a, b) { return niveles[a].orden - niveles[b].orden; })
        .map(function (k) {
          return { clave: k, etiqueta: niveles[k].etiqueta, descripcion: niveles[k].descripcion,
                   total: !!niveles[k].total };
        }),
      modulos: Object.keys(mods).sort(function (a, b) { return mods[a].orden - mods[b].orden; })
        .map(function (k) {
          return { clave: k, etiqueta: mods[k].etiqueta, acciones: mods[k].acciones,
                   nota: mods[k].nota, tablas: mods[k].tablas };
        }),
      matriz: m,
      editable: this.puede(ctx, 'PERMISOS', 'EDITAR')
    };
  },

  /**
   * Guarda la matriz de un nivel. Cada casilla modificada se audita por separado,
   * porque un cambio de permisos es exactamente el tipo de movimiento que hay que
   * poder reconstruir después.
   */
  guardar: function (ctx, nivel, cambios) {
    this.exigir(ctx, 'PERMISOS', 'EDITAR');
    nivel = String(nivel || '').toUpperCase();

    if (!NIVELES_()[nivel]) { throw new Error('Nivel de acceso desconocido: ' + nivel + '.'); }
    if (NIVELES_()[nivel].total) {
      throw new Error('El nivel Administrador tiene acceso total por diseño y no se puede modificar. ' +
                      'Si quieres limitar a alguien, cámbiale el nivel en Usuarios.');
    }

    var mods = MODULOS_();
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    var aplicados = 0;

    try {
      Object.keys(cambios).forEach(function (modulo) {
        if (!mods[modulo]) { return; }
        var fila = Db_.leer('PERMISO').filter(function (r) {
          return String(r.NIVEL_ACCESO).toUpperCase() === nivel &&
                 String(r.MODULO).toUpperCase() === modulo;
        })[0];

        var valores = {};
        mods[modulo].acciones.forEach(function (a) {
          valores[a] = cambios[modulo][a] ? 'SI' : 'NO';
        });
        // Las acciones que el módulo no contempla quedan en NO.
        ['VER', 'CREAR', 'EDITAR', 'ANULAR', 'PUBLICAR', 'ADMINISTRAR'].forEach(function (a) {
          if (valores[a] === undefined) { valores[a] = 'NO'; }
        });

        if (!fila) {
          valores.NIVEL_ACCESO = nivel;
          valores.MODULO = modulo;
          valores.ESTADO = 'ACTIVO';
          valores.OBSERVACIONES = '';
          var nueva = Seg_.crear('PERMISO', valores);
          var otorgadas = ['VER', 'CREAR', 'EDITAR', 'ANULAR', 'PUBLICAR', 'ADMINISTRAR']
            .filter(function (a) { return valores[a] === 'SI'; });
          Auditoria_.registrar(ctx, 'PERMISOS', 'PERMISO', nueva.IDPERMISO, nivel + '/' + modulo,
            'sin permisos', otorgadas.length ? otorgadas.join(', ') : 'sin permisos',
            'OK', 'Fila de permisos creada');
          aplicados++;
          return;
        }

        mods[modulo].acciones.forEach(function (a) {
          var antes = String(fila[a] || 'NO').toUpperCase();
          var despues = valores[a];
          if (antes === despues) { return; }
          Seg_.guardar('PERMISO', fila.IDPERMISO, valoresSueltos_(a, despues));
          Auditoria_.registrar(ctx, 'PERMISOS', 'PERMISO', fila.IDPERMISO,
            nivel + '/' + modulo + '/' + a, antes, despues, 'OK', '');
          aplicados++;
        });
      });
    } finally { lock.releaseLock(); }

    this.invalidar();
    return { cambios: aplicados };
  },

  /** Siembra la matriz inicial. La ejecuta instalar(). */
  sembrar: function () {
    var mods = MODULOS_();
    var iniciales = PERMISOS_INICIALES_();
    var existentes = {};
    Db_.leer('PERMISO').forEach(function (r) {
      existentes[String(r.NIVEL_ACCESO).toUpperCase() + '|' + String(r.MODULO).toUpperCase()] = true;
    });

    Object.keys(NIVELES_()).forEach(function (nivel) {
      Object.keys(mods).forEach(function (modulo) {
        if (existentes[nivel + '|' + modulo]) { return; }
        var permitidas = (NIVELES_()[nivel].total)
          ? mods[modulo].acciones
          : ((iniciales[nivel] || {})[modulo] || []);
        var fila = { NIVEL_ACCESO: nivel, MODULO: modulo, ESTADO: 'ACTIVO', OBSERVACIONES: '' };
        ['VER', 'CREAR', 'EDITAR', 'ANULAR', 'PUBLICAR', 'ADMINISTRAR'].forEach(function (a) {
          fila[a] = permitidas.indexOf(a) >= 0 ? 'SI' : 'NO';
        });
        Seg_.crear('PERMISO', fila);
      });
    });

    Permisos_.invalidar();
  }
};

function valoresSueltos_(campo, valor) {
  var o = {};
  o[campo] = valor;
  return o;
}
