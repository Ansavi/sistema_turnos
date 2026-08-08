/**
 * 13_Migracion.gs
 * Migración de la versión 1.0 a la 2.0.
 *
 * DÓNDE SE EJECUTA: Editor Apps Script → elegir `migrarAVersion2` → Ejecutar,
 * y leer el resultado en el panel "Registro de ejecución".
 *
 * No destruye nada: crea las hojas que faltan, añade las columnas nuevas al final
 * de cada hoja existente y las rellena con valores por defecto. Los datos que ya
 * tienes se conservan íntegros. Se puede ejecutar varias veces sin duplicar nada.
 */

function migrarAVersion2() {
  var pasos = [];
  var anotar = function (t) { pasos.push('  ' + t); console.log(t); };

  anotar('Iniciando migración a la versión 2.0…');

  // 1. Estructura: crea hojas nuevas y añade columnas que falten.
  var creadas = repararEstructura_(anotar);

  // 2. Valores por defecto en las columnas nuevas.
  rellenarValoresPorDefecto_(anotar);

  SpreadsheetApp.flush();

  // 3. Catálogos: tipos de día con prioridad, parámetros, permisos de módulos nuevos.
  actualizarCatalogos_(anotar);

  // 4. Recalcula lo derivado sobre los datos que ya existían.
  recalcularDerivados_(anotar);

  /**
   * 5. Reordena las columnas para que coincidan con el esquema.
   * Añadirlas al final no basta: la capa de datos lee por posición, así que una
   * columna nueva declarada en medio del esquema pero escrita al final hace que
   * todo lo que va después se lea corrido. Debe ir al final del proceso, cuando
   * ya están creadas todas las columnas.
   */
  anotar('Verificando el orden de las columnas…');
  var reordenadas = repararOrdenColumnas(anotar);
  if (reordenadas.length) {
    anotar('Hojas reordenadas: ' + reordenadas.length);
  }

  var texto = 'MIGRACIÓN A LA VERSIÓN 2.0\n' + '='.repeat(46) + '\n' +
              pasos.join('\n') + '\n' + '='.repeat(46) +
              '\nHojas nuevas: ' + creadas.length +
              (creadas.length ? ' (' + creadas.join(', ') + ')' : '') +
              '\n\nSiguiente paso: ejecuta verificarSistema para comprobar el resultado.';
  console.log(texto);
  try {
    SpreadsheetApp.getUi().alert('Migración completa',
      'Hojas nuevas: ' + creadas.length + '\n\nEl detalle está en el registro de ejecución.',
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (ignore) {}
  return texto;
}

/** Crea las hojas que falten y añade columnas nuevas sin tocar las existentes. */
function repararEstructura_(anotar) {
  var ss = SS_();
  var esquema = ESQUEMA_();
  var creadas = [];

  ORDEN_HOJAS_().forEach(function (clave) {
    var def = esquema[clave];
    var hoja = ss.getSheetByName(def.hoja);

    if (!hoja) {
      hoja = ss.insertSheet(def.hoja);
      prepararHoja_(hoja, def);
      creadas.push(def.hoja);
      anotar('Hoja creada: ' + def.hoja);
      return;
    }

    var esperados = def.campos.map(function (f) { return f.c; });
    var ultimaCol = Math.max(hoja.getLastColumn(), 1);
    var actuales = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0]
                       .map(function (v) { return String(v).trim(); })
                       .filter(function (v) { return v !== ''; });

    var faltantes = esperados.filter(function (c) { return actuales.indexOf(c) === -1; });
    if (faltantes.length) {
      // Se añaden al final: así no se desplaza ninguna columna con datos.
      hoja.getRange(1, actuales.length + 1, 1, faltantes.length).setValues([faltantes])
          .setFontWeight('bold').setBackground('#16202B').setFontColor('#FFFFFF');
      anotar('Columnas añadidas a ' + def.hoja + ': ' + faltantes.join(', '));
    }

    // Siempre, haya columnas nuevas o no: las listas desplegables de la versión
    // anterior siguen vigentes y rechazarían los valores nuevos.
    var ajustadas = actualizarValidaciones_(hoja, def);
    if (ajustadas.length) {
      anotar('Listas desplegables actualizadas en ' + def.hoja + ': ' + ajustadas.join(', '));
    }
  });

  SpreadsheetApp.flush();
  return creadas;
}

/**
 * Reaplica las listas desplegables de cada columna según el esquema vigente.
 *
 * Es imprescindible antes de escribir nada: Sheets guarda la regla de validación
 * dentro de la hoja, así que una columna creada por la versión 1 sigue aceptando
 * solo los valores de entonces. Al intentar escribir OPERADOR en NIVEL_ACCESO, o
 * CESADO en ESTADO_PERSONAL, la hoja los rechaza y la migración se detiene.
 *
 * El error además aparece desplazado: Apps Script agrupa las escrituras y la
 * excepción salta en la siguiente lectura, señalando una línea que no es la culpable.
 */
function actualizarValidaciones_(hoja, def) {
  var filas = Math.max(hoja.getMaxRows() - 1, 1);
  var ajustadas = [];

  def.campos.forEach(function (f, i) {
    if (f.t !== 'lista' || !f.ops || !f.ops.length) { return; }
    var rango = hoja.getRange(2, i + 1, filas, 1);
    rango.setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(f.ops, true)
        .setAllowInvalid(false)
        .setHelpText('Valores permitidos: ' + f.ops.join(', '))
        .build());
    ajustadas.push(f.c);
  });

  return ajustadas;
}

/** Rellena las columnas nuevas de las filas que ya existían. */
function rellenarValoresPorDefecto_(anotar) {
  var ss = SS_();
  var esquema = ESQUEMA_();
  var coberturaDefecto = PARAM_NUM_('COBERTURA_MINIMA_DEFECTO') || 1;

  // AREA: cobertura mínima
  var hojaArea = ss.getSheetByName(esquema.AREA.hoja);
  if (hojaArea && hojaArea.getLastRow() > 1) {
    var colCob = indiceColumna_(hojaArea, 'COBERTURA_MINIMA');
    if (colCob > 0) {
      var n = hojaArea.getLastRow() - 1;
      var vals = hojaArea.getRange(2, colCob, n, 1).getValues();
      var cambios = 0;
      for (var i = 0; i < vals.length; i++) {
        if (String(vals[i][0]).trim() === '') { vals[i][0] = coberturaDefecto; cambios++; }
      }
      if (cambios) {
        hojaArea.getRange(2, colCob, n, 1).setValues(vals);
        anotar('AREA: cobertura mínima asignada a ' + cambios + ' juzgado(s)');
      }
    }
  }

  // PERSONAL: estados antiguos INACTIVO pasan a SUSPENDIDO
  var hojaPer = ss.getSheetByName(esquema.PERSONAL.hoja);
  if (hojaPer && hojaPer.getLastRow() > 1) {
    var colEst = indiceColumna_(hojaPer, 'ESTADO_PERSONAL');
    if (colEst > 0) {
      var nP = hojaPer.getLastRow() - 1;
      var estados = hojaPer.getRange(2, colEst, nP, 1).getValues();
      var c2 = 0;
      for (var j = 0; j < estados.length; j++) {
        if (String(estados[j][0]).toUpperCase() === 'INACTIVO') { estados[j][0] = 'SUSPENDIDO'; c2++; }
      }
      if (c2) {
        hojaPer.getRange(2, colEst, nP, 1).setValues(estados);
        anotar('PERSONAL: ' + c2 + ' registro(s) pasan de INACTIVO a SUSPENDIDO');
      }
    }
  }

  // USUARIO: el nivel EDITOR pasa a llamarse OPERADOR
  var hojaUsu = ss.getSheetByName(esquema.USUARIO.hoja);
  if (hojaUsu && hojaUsu.getLastRow() > 1) {
    var colNiv = indiceColumna_(hojaUsu, 'NIVEL_ACCESO');
    if (colNiv > 0) {
      var nU = hojaUsu.getLastRow() - 1;
      var niveles = hojaUsu.getRange(2, colNiv, nU, 1).getValues();
      var c3 = 0;
      for (var k = 0; k < niveles.length; k++) {
        if (String(niveles[k][0]).toUpperCase() === 'EDITOR') { niveles[k][0] = 'OPERADOR'; c3++; }
      }
      if (c3) {
        hojaUsu.getRange(2, colNiv, nU, 1).setValues(niveles);
        anotar('USUARIO: ' + c3 + ' usuario(s) EDITOR pasan a OPERADOR');
      }
    }
  }

  // PERMISO: lo mismo en la matriz
  var hojaPms = ss.getSheetByName(esquema.PERMISO.hoja);
  if (hojaPms && hojaPms.getLastRow() > 1) {
    var colN2 = indiceColumna_(hojaPms, 'NIVEL_ACCESO');
    if (colN2 > 0) {
      var nM = hojaPms.getLastRow() - 1;
      var filas = hojaPms.getRange(2, colN2, nM, 1).getValues();
      var c4 = 0;
      for (var m = 0; m < filas.length; m++) {
        if (String(filas[m][0]).toUpperCase() === 'EDITOR') { filas[m][0] = 'OPERADOR'; c4++; }
      }
      if (c4) {
        hojaPms.getRange(2, colN2, nM, 1).setValues(filas);
        anotar('PERMISO: ' + c4 + ' fila(s) EDITOR pasan a OPERADOR');
      }
    }
  }
}

/** Siembra parámetros, actualiza tipos de día y completa la matriz de permisos. */
function actualizarCatalogos_(anotar) {
  // Parámetros
  var nuevos = 0;
  PARAMETROS_DEFECTO_().forEach(function (p) {
    if (Db_.buscarPor('PARAMETRO', 'CLAVE', p.clave)) { return; }
    Db_.insertarCrudo('PARAMETRO', {
      CLAVE: p.clave, VALOR: p.valor, TIPO_DATO: p.tipo,
      DESCRIPCION: p.desc, ESTADO: 'ACTIVO'
    });
    nuevos++;
  });
  if (nuevos) { anotar('PARAMETRO: ' + nuevos + ' parámetro(s) sembrados'); }

  // Tipos de día: prioridad, color y bloqueo
  var tipos = TIPOS_DIA_SISTEMA_();
  var creados = 0, actualizados = 0;
  Object.keys(tipos).forEach(function (nombre) {
    var t = tipos[nombre];
    var fila = Db_.buscarPor('TIPO_DIA', 'TIPO_DIA', nombre);
    if (!fila) {
      Db_.insertarCrudo('TIPO_DIA', {
        TIPO_DIA: nombre, PRIORIDAD: t.prioridad, COLOR: t.color,
        BLOQUEA_TRABAJO: t.bloquea ? 'SI' : 'NO', ESTADO_TIPO: 'ACTIVO',
        OBSERVACIONES: 'Tipo del sistema. No renombrar: el motor de reglas lo usa.'
      });
      creados++;
      return;
    }
    if (String(fila.PRIORIDAD) === String(t.prioridad) && fila.COLOR === t.color) { return; }
    Seg_.guardar('TIPO_DIA', fila.IDTIPO_DIA, {
      PRIORIDAD: t.prioridad, COLOR: t.color, BLOQUEA_TRABAJO: t.bloquea ? 'SI' : 'NO'
    });
    actualizados++;
  });
  if (creados) { anotar('TIPO_DIA: ' + creados + ' tipo(s) creados'); }
  if (actualizados) { anotar('TIPO_DIA: ' + actualizados + ' tipo(s) con prioridad y color actualizados'); }

  // Permisos de los módulos nuevos
  Permisos_.sembrar();
  Permisos_.invalidar();
  anotar('PERMISO: matriz completada con los módulos nuevos');
}

/** Recalcula lo que ahora es derivado sobre los datos que ya existían. */
function recalcularDerivados_(anotar) {
  // Turnos: cruce de medianoche y duración
  var nT = 0;
  Db_.leer('TURNO').forEach(function (t) {
    if (!t.HORA_INICIO || !t.HORA_FIN) { return; }
    var mIni = Utilidades_.aMinutos(t.HORA_INICIO);
    var mFin = Utilidades_.aMinutos(t.HORA_FIN);
    var cruza = mFin <= mIni;
    var dur = Math.round(((cruza ? mFin + 1440 : mFin) - mIni) / 6) / 10;
    if (String(t.CRUZA_MEDIANOCHE).toUpperCase() === (cruza ? 'SI' : 'NO') &&
        String(t.DURACION_HORAS) === String(dur)) { return; }
    Seg_.guardar('TURNO', t.IDTURNO, {
      CRUZA_MEDIANOCHE: cruza ? 'SI' : 'NO', DURACION_HORAS: dur
    });
    nT++;
  });
  if (nT) { anotar('TURNO: ' + nT + ' turno(s) con cruce de medianoche y duración recalculados'); }

  // Vacaciones: días desde las fechas
  var nV = 0;
  Db_.leer('VACACIONES').forEach(function (v) {
    if (!v.FECHA_INICIO) { return; }
    var fin = v.FECHA_FIN;
    if (!fin && v.DIAS) { fin = Utilidades_.sumarDias(v.FECHA_INICIO, Number(v.DIAS) - 1); }
    if (!fin) { return; }
    var dias = Utilidades_.diasEntre(v.FECHA_INICIO, fin);
    if (String(v.DIAS) === String(dias) && v.FECHA_FIN === fin) { return; }
    Seg_.guardar('VACACIONES', v.IDVACACIONES, { FECHA_FIN: fin, DIAS: dias });
    nV++;
  });
  if (nV) { anotar('VACACIONES: ' + nV + ' registro(s) con días recalculados'); }

  // Compensatorios: fecha de vencimiento
  var dias = PARAM_NUM_('DIAS_VIGENCIA_COMPENSATORIO') || 30;
  var nC = 0;
  Db_.leer('COMPENSATORIO').forEach(function (c) {
    if (!c.FECHA_GENERACION || c.FECHA_VENCIMIENTO) { return; }
    var cambios = { FECHA_VENCIMIENTO: Utilidades_.sumarDias(c.FECHA_GENERACION, dias) };
    // El estado APROBADO de la versión anterior equivale a PROGRAMADO.
    if (String(c.ESTADO_COMPENSATORIO).toUpperCase() === 'APROBADO') {
      cambios.ESTADO_COMPENSATORIO = c.FECHA_COMPENSATORIO ? 'PROGRAMADO' : 'PENDIENTE';
    }
    Seg_.guardar('COMPENSATORIO', c.IDCOMPENSATORIO, cambios);
    nC++;
  });
  if (nC) { anotar('COMPENSATORIO: ' + nC + ' registro(s) con vencimiento y estado ajustados'); }

  // Calendario: horas absolutas y versión inicial
  var nCal = 0;
  var turnos = {};
  Db_.leer('TURNO').forEach(function (t) { turnos[t.IDTURNO] = t; });
  Db_.leer('CALENDARIO_PERSONAL').forEach(function (r) {
    if (r.INICIO_PROGRAMADO) { return; }
    var cambios = { VERSION: Number(r.VERSION) || 1 };
    var t = turnos[r.IDTURNO];
    if (t && t.HORA_INICIO && t.HORA_FIN) {
      var cruza = Utilidades_.aMinutos(t.HORA_FIN) <= Utilidades_.aMinutos(t.HORA_INICIO);
      cambios.INICIO_PROGRAMADO = r.FECHA_CALENDARIO + ' ' + t.HORA_INICIO + ':00';
      cambios.FIN_PROGRAMADO =
        (cruza ? Utilidades_.sumarDias(r.FECHA_CALENDARIO, 1) : r.FECHA_CALENDARIO) +
        ' ' + t.HORA_FIN + ':00';
    }
    Seg_.guardar('CALENDARIO_PERSONAL', r.IDCALENDARIO_PERSONAL, cambios);
    nCal++;
  });
  if (nCal) { anotar('CALENDARIO_PERSONAL: ' + nCal + ' día(s) con horas absolutas calculadas'); }
}

function indiceColumna_(hoja, nombre) {
  var ultima = Math.max(hoja.getLastColumn(), 1);
  var cab = hoja.getRange(1, 1, 1, ultima).getValues()[0];
  for (var i = 0; i < cab.length; i++) {
    if (String(cab[i]).trim() === nombre) { return i + 1; }
  }
  return 0;
}

/**
 * Proceso diario: marca como VENCIDO los compensatorios que pasaron su fecha
 * límite sin usarse. No borra nada y deja constancia en la auditoría.
 */
function vencerCompensatorios() {
  var ctx = { correo: 'sistema', nivel: 'ADMIN', origen: 'PROCESO' };
  var hoy = Utilidades_.hoyISO();
  var n = 0;

  Db_.leer('COMPENSATORIO').forEach(function (c) {
    var est = String(c.ESTADO_COMPENSATORIO).toUpperCase();
    if (est !== 'PENDIENTE' && est !== 'PROGRAMADO') { return; }
    if (!c.FECHA_VENCIMIENTO || c.FECHA_VENCIMIENTO >= hoy) { return; }
    if (c.FECHA_COMPENSATORIO && c.FECHA_COMPENSATORIO >= hoy) { return; }

    Seg_.guardar('COMPENSATORIO', c.IDCOMPENSATORIO, { ESTADO_COMPENSATORIO: 'VENCIDO' });
    Auditoria_.registrar(ctx, 'VENCER', 'COMPENSATORIO', c.IDCOMPENSATORIO,
      'ESTADO_COMPENSATORIO', est, 'VENCIDO', 'OK',
      'Venció el ' + c.FECHA_VENCIMIENTO + ' sin utilizarse');
    n++;
  });

  console.log('Compensatorios vencidos: ' + n);
  return n;
}

/**
 * Marca como USADO el compensatorio cuyo día ya pasó.
 * Se ejecuta junto con el vencimiento, en el mismo trigger diario.
 */
function consumirCompensatorios() {
  var ctx = { correo: 'sistema', nivel: 'ADMIN', origen: 'PROCESO' };
  var hoy = Utilidades_.hoyISO();
  var n = 0;

  Db_.leer('COMPENSATORIO').forEach(function (c) {
    if (String(c.ESTADO_COMPENSATORIO).toUpperCase() !== 'PROGRAMADO') { return; }
    if (!c.FECHA_COMPENSATORIO || c.FECHA_COMPENSATORIO >= hoy) { return; }
    Seg_.guardar('COMPENSATORIO', c.IDCOMPENSATORIO, { ESTADO_COMPENSATORIO: 'USADO' });
    Auditoria_.registrar(ctx, 'CONSUMIR', 'COMPENSATORIO', c.IDCOMPENSATORIO,
      'ESTADO_COMPENSATORIO', 'PROGRAMADO', 'USADO', 'OK',
      'Tomado el ' + c.FECHA_COMPENSATORIO);
    n++;
  });

  console.log('Compensatorios consumidos: ' + n);
  return n;
}

/** Proceso diario único, para un solo trigger. */
function procesoDiario() {
  var r = {
    sesiones: limpiarSesiones(),
    vencidos: vencerCompensatorios(),
    usados: consumirCompensatorios()
  };
  console.log('Proceso diario: ' + JSON.stringify(r));
  return r;
}
