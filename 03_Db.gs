/**
 * 03_Db.gs
 * Repositorio genérico sobre Google Sheets.
 * Db_.insertar / actualizar / anular reciben un contexto de sesión y dejan traza en AUDITORIA.
 * Db_.insertarCrudo se usa solo durante la instalación.
 */

var Utilidades_ = {
  tz: function () { return CONFIG_().TZ; },

  hoyISO: function () {
    return Utilities.formatDate(new Date(), this.tz(), 'yyyy-MM-dd');
  },

  ahora: function () {
    return Utilities.formatDate(new Date(), this.tz(), 'yyyy-MM-dd HH:mm:ss');
  },

  /** Acepta Date, 'yyyy-MM-dd', 'dd/MM/yyyy' y devuelve 'yyyy-MM-dd' o ''. */
  aISO: function (v) {
    if (v === null || v === undefined || v === '') { return ''; }
    if (Object.prototype.toString.call(v) === '[object Date]') {
      return Utilities.formatDate(v, this.tz(), 'yyyy-MM-dd');
    }
    var s = String(v).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) { return m[1] + '-' + m[2] + '-' + m[3]; }
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    }
    return s;
  },

  /** Suma días a una fecha ISO sin tocar zonas horarias. */
  sumarDias: function (iso, n) {
    var p = String(iso).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + Number(n));
    return Utilities.formatDate(d, this.tz(), 'yyyy-MM-dd');
  },

  entre: function (iso, desde, hasta) {
    if (!iso || !desde) { return false; }
    return iso >= desde && (!hasta || iso <= hasta);
  },

  diasDelMes: function (anio, mes) {
    var total = new Date(anio, mes, 0).getDate();
    var out = [];
    for (var d = 1; d <= total; d++) {
      out.push(anio + '-' + ('0' + mes).slice(-2) + '-' + ('0' + d).slice(-2));
    }
    return out;
  },

  diaSemana: function (iso) {
    var p = String(iso).split('-');
    var idx = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
    return ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'][idx];
  },

  esFinDeSemana: function (iso) {
    var d = this.diaSemana(iso);
    return d === 'SABADO' || d === 'DOMINGO';
  },

  normalizar: function (s) {
    return String(s || '').trim().toUpperCase();
  }
};

var Db_ = {

  _hoja: function (tabla) {
    var def = ESQUEMA_()[tabla];
    if (!def) { throw new Error('Tabla desconocida: ' + tabla); }
    var hoja = SS_().getSheetByName(def.hoja);
    if (!hoja) { throw new Error('Falta la hoja ' + def.hoja + '. Ejecuta instalar().'); }
    return hoja;
  },

  def: function (tabla) { return ESQUEMA_()[tabla]; },

  /** Devuelve todas las filas como objetos, con _fila = número de fila en la hoja. */
  leer: function (tabla) {
    var def = this.def(tabla);
    var hoja = this._hoja(tabla);
    var ultima = hoja.getLastRow();
    if (ultima < 2) { return []; }

    var cols = def.campos.map(function (f) { return f.c; });
    var valores = hoja.getRange(2, 1, ultima - 1, cols.length).getValues();
    var tiposFecha = {};
    def.campos.forEach(function (f) { if (f.t === 'fecha') { tiposFecha[f.c] = true; } });

    var salida = [];
    for (var i = 0; i < valores.length; i++) {
      var fila = valores[i];
      if (String(fila[0]).trim() === '') { continue; }
      var obj = { _fila: i + 2 };
      for (var j = 0; j < cols.length; j++) {
        var v = fila[j];
        obj[cols[j]] = tiposFecha[cols[j]] ? Utilidades_.aISO(v) : (v === null ? '' : v);
      }
      salida.push(obj);
    }
    return salida;
  },

  buscarPorId: function (tabla, id) {
    return this.buscarPor(tabla, this.def(tabla).pk, id);
  },

  buscarPor: function (tabla, campo, valor) {
    var objetivo = Utilidades_.normalizar(valor);
    var filas = this.leer(tabla);
    for (var i = 0; i < filas.length; i++) {
      if (Utilidades_.normalizar(filas[i][campo]) === objetivo) { return filas[i]; }
    }
    return null;
  },

  filtrar: function (tabla, fn) {
    return this.leer(tabla).filter(fn);
  },

  /** ID correlativo tipo PER-0001, calculado sobre el máximo existente. */
  nuevoId: function (tabla) {
    var def = this.def(tabla);
    var max = 0;
    this.leer(tabla).forEach(function (r) {
      var m = String(r[def.pk]).match(/(\d+)$/);
      if (m) { max = Math.max(max, Number(m[1])); }
    });
    return def.prefijo + '-' + ('0000' + (max + 1)).slice(-4);
  },

  /** Escritura sin validaciones ni auditoría. Solo para el instalador. */
  insertarCrudo: function (tabla, datos) {
    var def = this.def(tabla);
    var hoja = this._hoja(tabla);
    var reg = {};
    reg[def.pk] = this.nuevoId(tabla);
    def.campos.forEach(function (f) {
      if (f.pk) { return; }
      reg[f.c] = datos[f.c] !== undefined ? datos[f.c] : (f.def || '');
    });
    hoja.appendRow(def.campos.map(function (f) { return reg[f.c]; }));
    return reg;
  },

  /** Valida un registro contra el esquema. Devuelve array de mensajes. */
  validar: function (tabla, datos, idActual) {
    var def = this.def(tabla);
    var errores = [];
    var existentes = null;

    def.campos.forEach(function (f) {
      if (f.pk) { return; }
      var v = datos[f.c];
      var vacio = (v === undefined || v === null || String(v).trim() === '');

      if (f.req && vacio) { errores.push('Falta ' + f.c + '.'); return; }
      if (vacio) { return; }

      if (f.t === 'fecha' && !/^\d{4}-\d{2}-\d{2}$/.test(Utilidades_.aISO(v))) {
        errores.push(f.c + ' debe tener formato AAAA-MM-DD.');
      }
      if (f.t === 'hora' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v).trim())) {
        errores.push(f.c + ' debe tener formato HH:MM (24 horas).');
      }
      if (f.t === 'correo' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v).trim())) {
        errores.push(f.c + ' no es un correo válido.');
      }
      if (f.t === 'numero') {
        var n = Number(v);
        if (isNaN(n)) { errores.push(f.c + ' debe ser numérico.'); }
        else if (f.min !== undefined && n < f.min) { errores.push(f.c + ' no puede ser menor que ' + f.min + '.'); }
        else if (f.max !== undefined && n > f.max) { errores.push(f.c + ' no puede ser mayor que ' + f.max + '.'); }
      }
      if (f.t === 'lista' && f.ops && f.ops.indexOf(String(v).trim()) === -1) {
        errores.push(f.c + ' debe ser uno de: ' + f.ops.join(', ') + '.');
      }
      if (f.t === 'ref' && !Db_.buscarPorId(f.ref, v)) {
        errores.push(f.c + ' apunta a un registro inexistente en ' + f.ref + '.');
      }
      if (f.largoMax && String(v).length > f.largoMax) {
        errores.push(f.c + ' supera ' + f.largoMax + ' caracteres.');
      }
      if (f.unico) {
        if (existentes === null) { existentes = Db_.leer(tabla); }
        var choque = existentes.some(function (r) {
          return r[def.pk] !== idActual &&
                 Utilidades_.normalizar(r[f.c]) === Utilidades_.normalizar(v);
        });
        if (choque) { errores.push(f.c + ' ya existe en otro registro.'); }
      }
    });

    return errores.concat(Reglas_.validacionesDeNegocio(tabla, datos, idActual));
  },

  insertar: function (tabla, datos, ctx) {
    var def = this.def(tabla);
    datos = this._derivar(tabla, datos);
    var errores = this.validar(tabla, datos, null);
    if (errores.length) {
      Auditoria_.registrar(ctx, 'CREAR', tabla, '', '', '', '', 'RECHAZADO', errores.join(' | '));
      throw new Error(errores.join('\n'));
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var reg = {};
      reg[def.pk] = this.nuevoId(tabla);
      def.campos.forEach(function (f) {
        if (f.pk) { return; }
        var v = datos[f.c];
        reg[f.c] = (v === undefined || v === null) ? (f.def || '') :
                   (f.t === 'fecha' ? Utilidades_.aISO(v) : v);
      });
      this._hoja(tabla).appendRow(def.campos.map(function (f) { return reg[f.c]; }));
      Auditoria_.registrar(ctx, 'CREAR', tabla, reg[def.pk], '', '',
        JSON.stringify(reg), 'OK', '');
      return reg;
    } finally { lock.releaseLock(); }
  },

  actualizar: function (tabla, id, cambios, ctx) {
    var def = this.def(tabla);
    var actual = this.buscarPorId(tabla, id);
    if (!actual) { throw new Error('No existe el registro ' + id + ' en ' + tabla + '.'); }

    var propuesto = {};
    def.campos.forEach(function (f) {
      propuesto[f.c] = (cambios[f.c] !== undefined) ? cambios[f.c] : actual[f.c];
    });
    propuesto = this._derivar(tabla, propuesto);

    var errores = this.validar(tabla, propuesto, id);
    if (errores.length) {
      Auditoria_.registrar(ctx, 'ACTUALIZAR', tabla, id, '', '', '', 'RECHAZADO', errores.join(' | '));
      throw new Error(errores.join('\n'));
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var hoja = this._hoja(tabla);
      var fila = actual._fila;
      var cambiosReales = [];
      def.campos.forEach(function (f, i) {
        if (f.pk) { return; }
        var antes = String(actual[f.c] === null ? '' : actual[f.c]);
        var despues = f.t === 'fecha' ? Utilidades_.aISO(propuesto[f.c]) : String(propuesto[f.c] || '');
        if (antes !== despues) {
          hoja.getRange(fila, i + 1).setValue(despues);
          cambiosReales.push({ campo: f.c, antes: antes, despues: despues });
        }
      });
      cambiosReales.forEach(function (c) {
        Auditoria_.registrar(ctx, 'ACTUALIZAR', tabla, id, c.campo, c.antes, c.despues, 'OK', '');
      });
      if (!cambiosReales.length) {
        Auditoria_.registrar(ctx, 'ACTUALIZAR', tabla, id, '', '', '', 'SIN_CAMBIOS', '');
      }
      return this.buscarPorId(tabla, id);
    } finally { lock.releaseLock(); }
  },

  /** Baja lógica: cambia el campo de estado a INACTIVO o ANULADO. */
  anular: function (tabla, id, ctx) {
    var def = this.def(tabla);
    if (!def.estado) { throw new Error(def.etiqueta + ' no admite baja lógica.'); }
    var campo = def.estado;
    var opciones = def.campos.filter(function (f) { return f.c === campo; })[0].ops || [];
    var destino = opciones.indexOf('ANULADO') >= 0 ? 'ANULADO' : 'INACTIVO';
    var cambios = {};
    cambios[campo] = destino;
    return this.actualizar(tabla, id, cambios, ctx);
  },

  /** Campos calculados por el sistema antes de validar. */
  _derivar: function (tabla, datos) {
    var d = {};
    Object.keys(datos).forEach(function (k) { d[k] = datos[k]; });

    if (tabla === 'VACACIONES' && d.FECHA_INICIO && d.DIAS) {
      d.FECHA_FIN = Utilidades_.sumarDias(Utilidades_.aISO(d.FECHA_INICIO), Number(d.DIAS) - 1);
    }
    if (tabla === 'CUMPLEANIOS' && d.IDPERSONAL && !d.FECHA_BENEFICIO && d.ANIO_BENEFICIO) {
      var p = Db_.buscarPorId('PERSONAL', d.IDPERSONAL);
      if (p && p.FECHA_NAC) {
        d.FECHA_BENEFICIO = d.ANIO_BENEFICIO + '-' + String(p.FECHA_NAC).substring(5, 10);
      }
    }
    return d;
  }
};
