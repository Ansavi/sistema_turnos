/**
 * 10_Verificacion.gs
 * Diagnóstico del sistema desde dentro de Apps Script.
 *
 * DÓNDE SE EJECUTA: Editor Apps Script → elegir `verificarSistema` en el desplegable
 * de funciones → Ejecutar → leer el panel "Registro de ejecución".
 * También está en la Hoja de cálculo: menú Sistema de Turnos → Verificar sistema.
 *
 * Es NO DESTRUCTIVO: solo lee. No crea, no modifica y no borra ningún dato.
 * Por eso puede ejecutarse en producción cuando algo se comporta raro.
 *
 * No confundir con humo.js, que es un archivo de Node.js para la terminal del PC
 * y NO debe pegarse en este proyecto.
 */

function verificarSistema() {
  var R = { ok: 0, avisos: [], fallos: [], lineas: [] };

  R.titulo = function (t) { this.lineas.push('', '── ' + t + ' ' + '─'.repeat(Math.max(0, 46 - t.length))); };
  R.comprobar = function (nombre, fn) {
    try {
      var d = fn();
      if (d === false) { throw new Error('no cumple'); }
      this.ok++;
      this.lineas.push('  OK    ' + nombre + (typeof d === 'string' ? ' → ' + d : ''));
    } catch (e) {
      this.fallos.push(nombre + ': ' + e.message);
      this.lineas.push('  FALLA ' + nombre + ' → ' + e.message);
    }
  };
  R.avisar = function (nombre, fn) {
    try {
      var d = fn();
      if (d) { this.avisos.push(nombre + ': ' + d); this.lineas.push('  AVISO ' + nombre + ' → ' + d); }
      else { this.ok++; this.lineas.push('  OK    ' + nombre); }
    } catch (e) {
      this.fallos.push(nombre + ': ' + e.message);
      this.lineas.push('  FALLA ' + nombre + ' → ' + e.message);
    }
  };

  var ss = SS_();
  var esquema = ESQUEMA_();

  /* ---------------- Estructura ---------------- */
  R.titulo('ESTRUCTURA DE HOJAS');
  ORDEN_HOJAS_().forEach(function (clave) {
    var def = esquema[clave];
    R.comprobar('hoja ' + def.hoja, function () {
      var hoja = ss.getSheetByName(def.hoja);
      if (!hoja) { throw new Error('no existe. Ejecuta instalar()'); }
      // Lo que importa es que la columna EXISTA. El sistema la localiza por su
      // encabezado, así que el orden es indiferente para el funcionamiento.
      var faltan = Db_.columnasFaltantes(clave);
      if (faltan.length) {
        throw new Error('faltan columnas: ' + faltan.join(', ') + '. Ejecuta migrarAVersion2()');
      }
      return Math.max(hoja.getLastRow() - 1, 0) + ' registro(s)';
    });

    // El desorden de columnas es solo cosmético: se informa, no se marca como fallo.
    R.avisar('orden de columnas en ' + def.hoja, function () {
      var hoja = ss.getSheetByName(def.hoja);
      if (!hoja) { return ''; }
      var esperados = def.campos.map(function (f) { return f.c; });
      var reales = hoja.getRange(1, 1, 1, Math.max(hoja.getLastColumn(), 1)).getValues()[0]
                       .map(function (v) { return String(v).trim(); });
      var distinto = esperados.some(function (c, i) { return reales[i] !== c; });
      return distinto
        ? 'difiere del esquema. No afecta al funcionamiento: el sistema localiza cada columna por su encabezado'
        : '';
    });
  });

  R.avisar('CREDENCIAL y SESION ocultas', function () {
    var visibles = ['CREDENCIAL', 'SESION'].filter(function (t) {
      var h = ss.getSheetByName(esquema[t].hoja);
      return h && !h.isSheetHidden();
    });
    return visibles.length ? 'están visibles: ' + visibles.join(', ') : '';
  });

  /* ---------------- Integridad referencial ---------------- */
  R.titulo('INTEGRIDAD REFERENCIAL');
  Object.keys(esquema).forEach(function (tabla) {
    var def = esquema[tabla];
    var refs = def.campos.filter(function (f) { return f.t === 'ref'; });
    if (!refs.length) { return; }

    R.avisar('claves foráneas de ' + tabla, function () {
      var filas = Db_.leer(tabla);
      var huerfanas = [];
      refs.forEach(function (f) {
        var validos = {};
        Db_.leer(f.ref).forEach(function (r) { validos[r[ESQUEMA_()[f.ref].pk]] = true; });
        filas.forEach(function (fila) {
          var v = fila[f.c];
          if (v && !validos[v]) { huerfanas.push(fila[def.pk] + '.' + f.c + '=' + v); }
        });
      });
      return huerfanas.length
        ? huerfanas.length + ' referencia(s) rota(s): ' + huerfanas.slice(0, 3).join(', ')
        : '';
    });
  });

  /* ---------------- Seguridad ---------------- */
  R.titulo('SEGURIDAD Y ACCESOS');

  R.comprobar('hay al menos un administrador activo', function () {
    var n = Db_.leer('USUARIO').filter(function (u) {
      return String(u.NIVEL_ACCESO).toUpperCase() === 'ADMIN' &&
             String(u.ESTADO_USUARIO).toUpperCase() === 'ACTIVO';
    }).length;
    if (!n) { throw new Error('ninguno. Ejecuta repararAcceso()'); }
    return n + ' administrador(es)';
  });

  R.comprobar('la matriz de permisos está completa', function () {
    var mods = Object.keys(MODULOS_());
    var niveles = Object.keys(NIVELES_());
    var existentes = {};
    Db_.leer('PERMISO').forEach(function (p) {
      existentes[String(p.NIVEL_ACCESO).toUpperCase() + '|' + String(p.MODULO).toUpperCase()] = true;
    });
    var faltan = [];
    niveles.forEach(function (n) {
      mods.forEach(function (m) { if (!existentes[n + '|' + m]) { faltan.push(n + '/' + m); } });
    });
    if (faltan.length) { throw new Error('faltan ' + faltan.length + ': ' + faltan.slice(0, 4).join(', ')); }
    return (niveles.length * mods.length) + ' combinaciones';
  });

  R.comprobar('ADMIN conserva acceso total', function () {
    var mods = MODULOS_();
    var faltan = [];
    Object.keys(mods).forEach(function (m) {
      mods[m].acciones.forEach(function (a) {
        if (!Permisos_.puede('ADMIN', m, a)) { faltan.push(m + '/' + a); }
      });
    });
    if (faltan.length) { throw new Error('sin acceso a ' + faltan.join(', ')); }
    return 'todos los módulos';
  });

  R.avisar('usuarios activos sin credenciales', function () {
    var conCred = {};
    Db_.leer('CREDENCIAL').forEach(function (c) { conCred[c.IDUSUARIO] = true; });
    var sin = Db_.leer('USUARIO').filter(function (u) {
      return String(u.ESTADO_USUARIO).toUpperCase() === 'ACTIVO' && !conCred[u.IDUSUARIO];
    });
    return sin.length ? sin.length + ' usuario(s) no pueden ingresar: ' +
      sin.slice(0, 3).map(function (u) { return u.IDUSUARIO; }).join(', ') : '';
  });

  R.avisar('cuentas bloqueadas', function () {
    var b = Db_.leer('CREDENCIAL').filter(function (c) {
      return String(c.ESTADO_CREDENCIAL).toUpperCase() === 'BLOQUEADA';
    });
    return b.length ? b.length + ' cuenta(s): ' +
      b.map(function (c) { return c.USUARIO_LOGIN; }).join(', ') : '';
  });

  R.avisar('sesiones abiertas ya vencidas', function () {
    var ahora = Utilidades_.ahora();
    var v = Db_.leer('SESION').filter(function (s) {
      return String(s.ESTADO_SESION).toUpperCase() === 'ABIERTA' && String(s.FECHA_EXPIRA) < ahora;
    });
    return v.length ? v.length + ' sesión(es). Ejecuta limpiarSesiones()' : '';
  });

  R.avisar('tamaño de la hoja SESION', function () {
    var n = Db_.leer('SESION').length;
    return n > 2000 ? n + ' filas: conviene purgar las cerradas de más de un mes' : '';
  });

  R.comprobar('el hash de contraseñas es determinista', function () {
    var salt = Cripto_.salt();
    var a = Cripto_.derivar('PruebaLocal123', salt, 50);
    var b = Cripto_.derivar('PruebaLocal123', salt, 50);
    var c = Cripto_.derivar('PruebaLocal124', salt, 50);
    if (!Cripto_.iguales(a, b)) { throw new Error('misma clave da hashes distintos'); }
    if (Cripto_.iguales(a, c)) { throw new Error('claves distintas dan el mismo hash'); }
    return 'verificado';
  });

  R.comprobar('coste del cifrado', function () {
    var t0 = new Date().getTime();
    Cripto_.derivar('PruebaLocal123', Cripto_.salt(), SEGURIDAD_().ITERACIONES);
    var ms = new Date().getTime() - t0;
    if (ms > 4000) {
      throw new Error(ms + ' ms por ingreso: demasiado lento. Baja ITERACIONES a ~' +
        Math.round(SEGURIDAD_().ITERACIONES * 1500 / ms) + ' en 01_Config.gs');
    }
    return ms + ' ms por ingreso, ' + (ms * 2) + ' ms al cambiar contraseña';
  });

  /* ---------------- Lógica de fechas ---------------- */
  R.titulo('LÓGICA DE FECHAS');
  R.comprobar('suma de días cruzando el año', function () {
    var r = Utilidades_.sumarDias('2026-12-28', 14);
    if (r !== '2027-01-11') { throw new Error('dio ' + r + ', se esperaba 2027-01-11'); }
    return '2026-12-28 + 14 = ' + r;
  });
  R.comprobar('febrero bisiesto', function () {
    var n = Utilidades_.diasDelMes(2028, 2).length;
    if (n !== 29) { throw new Error('dio ' + n + ' días'); }
    return '2028 tiene 29';
  });
  R.comprobar('día de la semana', function () {
    var d = Utilidades_.diaSemana('2026-08-07');
    if (d !== 'VIERNES') { throw new Error('dio ' + d); }
    return '2026-08-07 es ' + d;
  });
  R.comprobar('zona horaria del libro', function () {
    var tz = ss.getSpreadsheetTimeZone();
    if (tz !== CONFIG_().TZ) {
      throw new Error('la hoja usa ' + tz + ' y la configuración ' + CONFIG_().TZ);
    }
    return tz;
  });

  /* ---------------- Datos del calendario ---------------- */
  R.titulo('CONSISTENCIA DE DATOS');

  R.avisar('programaciones duplicadas (misma persona y fecha)', function () {
    var vistos = {}, dup = [];
    Db_.leer('CALENDARIO_PERSONAL').forEach(function (r) {
      if (String(r.ESTADO_PROGRAMACION).toUpperCase() === 'ANULADO') { return; }
      var k = r.IDPERSONAL + '|' + r.FECHA_CALENDARIO;
      if (vistos[k]) { dup.push(k); } else { vistos[k] = true; }
    });
    return dup.length ? dup.length + ' duplicado(s): ' + dup.slice(0, 3).join(', ') : '';
  });

  R.avisar('personas programadas a trabajar durante una ausencia', function () {
    var cal = Db_.leer('CALENDARIO_PERSONAL').filter(function (r) {
      return String(r.ESTADO_PROGRAMACION).toUpperCase() !== 'ANULADO';
    });
    if (!cal.length) { return ''; }

    var fechas = cal.map(function (r) { return r.FECHA_CALENDARIO; }).sort();
    var mapa = Reglas_.mapaAusencias(fechas[0], fechas[fechas.length - 1]);
    var idTrabajo = Reglas_.idTipoDia('TRABAJO');

    var choques = cal.filter(function (r) {
      if (r.IDTIPO_DIA !== idTrabajo) { return false; }
      var au = mapa[r.IDPERSONAL] && mapa[r.IDPERSONAL][r.FECHA_CALENDARIO];
      return au && au.nivel === 'BLOQUEO';
    });
    return choques.length ? choques.length + ' caso(s), el primero el ' + choques[0].FECHA_CALENDARIO +
      '. Suelen venir de editar la hoja a mano' : '';
  });

  R.avisar('vacaciones sin fecha fin calculada', function () {
    var malas = Db_.leer('VACACIONES').filter(function (v) {
      return v.FECHA_INICIO && v.DIAS &&
             v.FECHA_FIN !== Utilidades_.sumarDias(v.FECHA_INICIO, Number(v.DIAS) - 1);
    });
    return malas.length ? malas.length + ' registro(s) descuadrados: ' +
      malas.slice(0, 3).map(function (v) { return v.IDVACACIONES; }).join(', ') : '';
  });

  R.avisar('áreas sin turnos habilitados', function () {
    var conTurno = {};
    Db_.leer('AREA_TURNO').forEach(function (at) {
      if (String(at.ESTADO).toUpperCase() === 'ACTIVO') { conTurno[at.IDAREA] = true; }
    });
    var sin = Db_.leer('AREA').filter(function (a) {
      return String(a.ESTADO_AREA).toUpperCase() === 'ACTIVO' && !conTurno[a.IDAREA];
    });
    return sin.length ? sin.map(function (a) { return a.AREA; }).join(', ') +
      ' (no se podrá programar trabajo ahí)' : '';
  });

  R.avisar('tipos de día del sistema presentes', function () {
    var faltan = Object.keys(TIPOS_DIA_SISTEMA_()).filter(function (t) {
      return !Db_.buscarPor('TIPO_DIA', 'TIPO_DIA', t);
    });
    return faltan.length ? 'faltan: ' + faltan.join(', ') + '. Ejecuta instalar()' : '';
  });

  R.avisar('tamaño de la hoja AUDITORIA', function () {
    var n = Db_.leer('AUDITORIA').length;
    return n > 50000 ? n + ' filas: archiva las de años anteriores para no perder velocidad' : '';
  });

  /* ---------------- Informe ---------------- */
  var resumen = R.ok + ' correctas · ' + R.avisos.length + ' aviso(s) · ' + R.fallos.length + ' fallo(s)';
  var texto = 'VERIFICACIÓN DEL SISTEMA DE TURNOS  ' + Utilidades_.ahora() +
              '\n' + '='.repeat(56) +
              R.lineas.join('\n') +
              '\n' + '='.repeat(56) + '\n' + resumen;

  if (R.fallos.length) {
    texto += '\n\nFALLOS QUE HAY QUE CORREGIR:\n· ' + R.fallos.join('\n· ');
  }
  if (R.avisos.length) {
    texto += '\n\nAVISOS (no impiden funcionar, conviene revisarlos):\n· ' + R.avisos.join('\n· ');
  }

  console.log(texto);
  try {
    SpreadsheetApp.getUi().alert(
      R.fallos.length ? 'Verificación: hay fallos' : 'Verificación completa',
      resumen + '\n\nEl detalle completo está en el registro de ejecución del editor de Apps Script.' +
      (R.fallos.length ? '\n\nPrimer fallo:\n' + R.fallos[0] : ''),
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (ignore) { /* ejecutado desde el editor: basta el registro */ }

  return resumen;
}
