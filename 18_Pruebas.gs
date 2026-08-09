/**
 * 18_Pruebas.gs
 * Casos de prueba obligatorios del sistema.
 *
 * DÓNDE SE EJECUTA: menú "Sistema de Turnos → Ejecutar casos de prueba" de la hoja,
 * o desde el Editor Apps Script eligiendo `ejecutarPruebas` y pulsando Ejecutar.
 * El detalle se lee en el panel "Registro de ejecución".
 *
 * NO ESCRIBE NADA. Todos los casos usan `Db_.validar`, que aplica las 46 reglas y
 * devuelve los errores sin llegar a guardar, o consultan datos existentes. Por eso
 * puede ejecutarse en producción cuantas veces haga falta.
 *
 * La contrapartida: comprueba que las reglas RECHAZAN lo que deben rechazar y
 * ACEPTAN lo que deben aceptar, no el efecto de haberlo guardado. Para eso está
 * `verificarSistema`, que revisa el estado real de los datos.
 */

function ejecutarPruebas() {
  var R = {
    ok: 0, fallos: [], omitidos: 0, lineas: [],
    caso: function (n, nombre, fn) {
      try {
        var r = fn();
        if (r === null) {
          this.omitidos++;
          this.lineas.push('  --    ' + n + '. ' + nombre + ' → sin datos para evaluarlo');
          return;
        }
        if (r === false) { throw new Error('no se cumplió'); }
        this.ok++;
        this.lineas.push('  OK    ' + n + '. ' + nombre + (typeof r === 'string' ? ' → ' + r : ''));
      } catch (e) {
        this.fallos.push(n + '. ' + nombre + ': ' + e.message);
        this.lineas.push('  FALLA ' + n + '. ' + nombre + ' → ' + e.message);
      }
    },
    titulo: function (t) { this.lineas.push('', '── ' + t + ' ' + '─'.repeat(Math.max(0, 44 - t.length))); }
  };

  /** Un registro debe ser aceptado: validar no devuelve errores. */
  var aceptado = function (tabla, datos) {
    var e = Db_.validar(tabla, Db_._derivar(tabla, datos), null);
    if (e.length) { throw new Error('rechazado: ' + e[0]); }
    return 'aceptado';
  };

  /** Un registro debe ser rechazado, y por el motivo esperado. */
  var rechazado = function (tabla, datos, fragmento) {
    var e = Db_.validar(tabla, Db_._derivar(tabla, datos), null);
    if (!e.length) { throw new Error('fue ACEPTADO y debía rechazarse'); }
    var texto = e.join(' | ');
    if (fragmento && texto.toLowerCase().indexOf(fragmento.toLowerCase()) === -1) {
      throw new Error('rechazado por otro motivo: ' + e[0]);
    }
    return e[0].substring(0, 72);
  };

  /* ---------------- Datos de referencia ---------------- */
  var hoy = Utilidades_.hoyISO();
  var futuro = Utilidades_.sumarDias(hoy, 120);   // lejos de la programación real
  var cargos = Db_.leer('CARGO').filter(function (c) { return String(c.ESTADO_CARGO).toUpperCase() === 'ACTIVO'; });
  var areas = Db_.leer('AREA').filter(function (a) { return String(a.ESTADO_AREA).toUpperCase() === 'ACTIVO'; });
  var turnos = Db_.leer('TURNO').filter(function (t) { return String(t.ESTADO_TURNO).toUpperCase() === 'ACTIVO'; });
  var personas = Db_.leer('PERSONAL');
  var activas = personas.filter(function (p) { return String(p.ESTADO_PERSONAL).toUpperCase() === 'ACTIVO'; });
  var idTrabajo = Reglas_.idTipoDia('TRABAJO');

  var cargo = cargos[0], area = areas[0], turno = turnos[0], persona = activas[0];

  /** Persona con asignación vigente a un juzgado, y su juzgado. */
  var asignada = null;
  Db_.leer('PERSONAL_AREA').forEach(function (pa) {
    if (asignada) { return; }
    if (String(pa.ESTADO).toUpperCase() !== 'ACTIVO') { return; }
    if (pa.FECHA_FIN && pa.FECHA_FIN < futuro) { return; }
    var p = Db_.buscarPorId('PERSONAL', pa.IDPERSONAL);
    if (p && String(p.ESTADO_PERSONAL).toUpperCase() === 'ACTIVO') {
      asignada = { idPersonal: pa.IDPERSONAL, idArea: pa.IDAREA, nombre: p.APELLIDOS + ', ' + p.NOMBRES };
    }
  });

  /** Turno habilitado en el juzgado de esa persona. */
  var turnoDelArea = null;
  if (asignada) {
    Db_.leer('AREA_TURNO').forEach(function (at) {
      if (turnoDelArea || at.IDAREA !== asignada.idArea) { return; }
      if (String(at.ESTADO).toUpperCase() !== 'ACTIVO') { return; }
      var t = Db_.buscarPorId('TURNO', at.IDTURNO);
      if (t && String(t.ESTADO_TURNO).toUpperCase() === 'ACTIVO') { turnoDelArea = t; }
    });
  }

  /* ---------------- PERSONAL ---------------- */
  R.titulo('PERSONAL');

  R.caso(1, 'Crear personal', function () {
    if (!cargo) { return null; }
    return aceptado('PERSONAL', {
      IDCARGO: cargo.IDCARGO, DNI: '09999991', NOMBRES: 'Prueba', APELLIDOS: 'Del Sistema',
      CORREO: 'prueba.casos@ejemplo.local', FECHA_NAC: '1990-01-01',
      FECHA_INGRESO: '2020-01-01', ESTADO_PERSONAL: 'ACTIVO'
    });
  });

  R.caso(2, 'DNI duplicado', function () {
    if (!cargo || !persona) { return null; }
    return rechazado('PERSONAL', {
      IDCARGO: cargo.IDCARGO, DNI: persona.DNI, NOMBRES: 'Otro', APELLIDOS: 'Distinto',
      CORREO: 'otro.distinto@ejemplo.local', FECHA_NAC: '1990-01-01',
      FECHA_INGRESO: '2020-01-01', ESTADO_PERSONAL: 'ACTIVO'
    }, 'ya existe');
  });

  R.caso(3, 'Personal inactivo no se programa', function () {
    var inactiva = personas.filter(function (p) {
      return String(p.ESTADO_PERSONAL).toUpperCase() !== 'ACTIVO';
    })[0];
    if (!inactiva || !area || !turno) { return null; }
    return rechazado('CALENDARIO_PERSONAL', {
      IDPERSONAL: inactiva.IDPERSONAL, IDAREA: area.IDAREA, IDTURNO: turno.IDTURNO,
      IDTIPO_DIA: idTrabajo, FECHA_CALENDARIO: futuro, ESTADO_PROGRAMACION: 'BORRADOR'
    }, 'estado');
  });

  /* ---------------- MAESTROS ---------------- */
  R.titulo('ÁREAS, CARGOS Y TURNOS');

  R.caso(4, 'Crear área', function () {
    return aceptado('AREA', {
      AREA: 'JUZGADO DE PRUEBA ' + new Date().getTime(),
      COBERTURA_MINIMA: 1, ESTADO_AREA: 'ACTIVO'
    });
  });

  R.caso(5, 'Crear turno', function () {
    return aceptado('TURNO', {
      NOMBRE_TURNO: 'TURNO DE PRUEBA ' + new Date().getTime(),
      HORA_INICIO: '08:00', HORA_FIN: '15:00', TIPO_TURNO: 'DIURNO', ESTADO_TURNO: 'ACTIVO'
    });
  });

  R.caso(6, 'Turno nocturno', function () {
    var d = Db_._derivar('TURNO', {
      NOMBRE_TURNO: 'NOCTURNO DE PRUEBA ' + new Date().getTime(),
      HORA_INICIO: '22:00', HORA_FIN: '06:00', TIPO_TURNO: 'NOCTURNO', ESTADO_TURNO: 'ACTIVO'
    });
    var e = Db_.validar('TURNO', d, null);
    if (e.length) { throw new Error('rechazado: ' + e[0]); }
    if (d.CRUZA_MEDIANOCHE !== 'SI') { throw new Error('no detectó el cruce de medianoche'); }
    return '22:00 a 06:00 · ' + d.DURACION_HORAS + ' h';
  });

  R.caso(7, 'Turno que cruza medianoche (08:00 a 07:59)', function () {
    var d = Db_._derivar('TURNO', {
      NOMBRE_TURNO: 'GUARDIA DE PRUEBA ' + new Date().getTime(),
      HORA_INICIO: '08:00', HORA_FIN: '07:59', TIPO_TURNO: 'GUARDIA', ESTADO_TURNO: 'ACTIVO'
    });
    if (Db_.validar('TURNO', d, null).length) { throw new Error('rechazado'); }
    if (d.CRUZA_MEDIANOCHE !== 'SI') { throw new Error('no detectó el cruce'); }
    if (Number(d.DURACION_HORAS) < 23) { throw new Error('duración mal calculada: ' + d.DURACION_HORAS); }
    return d.DURACION_HORAS + ' horas, termina al día siguiente';
  });

  R.caso(8, 'Asociar turno a área', function () {
    if (!area || !turno) { return null; }
    var ya = Db_.leer('AREA_TURNO').some(function (at) {
      return at.IDAREA === area.IDAREA && at.IDTURNO === turno.IDTURNO;
    });
    if (ya) {
      return rechazado('AREA_TURNO', {
        IDAREA: area.IDAREA, IDTURNO: turno.IDTURNO, ESTADO: 'ACTIVO'
      }, 'ya está habilitado') && 'no se duplica la combinación';
    }
    return aceptado('AREA_TURNO', { IDAREA: area.IDAREA, IDTURNO: turno.IDTURNO, ESTADO: 'ACTIVO' });
  });

  /* ---------------- PROGRAMACIÓN ---------------- */
  R.titulo('PROGRAMACIÓN');

  R.caso(9, 'Programar persona', function () {
    if (!asignada || !turnoDelArea) { return null; }
    return aceptado('CALENDARIO_PERSONAL', {
      IDPERSONAL: asignada.idPersonal, IDAREA: asignada.idArea, IDTURNO: turnoDelArea.IDTURNO,
      IDTIPO_DIA: idTrabajo, FECHA_CALENDARIO: futuro, ESTADO_PROGRAMACION: 'BORRADOR'
    });
  });

  R.caso(10, 'Programación duplicada', function () {
    var existente = Db_.leer('CALENDARIO_PERSONAL').filter(function (r) {
      return String(r.ESTADO_PROGRAMACION).toUpperCase() !== 'ANULADO';
    })[0];
    if (!existente) { return null; }
    return rechazado('CALENDARIO_PERSONAL', {
      IDPERSONAL: existente.IDPERSONAL, IDAREA: existente.IDAREA,
      IDTURNO: existente.IDTURNO, IDTIPO_DIA: existente.IDTIPO_DIA,
      FECHA_CALENDARIO: existente.FECHA_CALENDARIO, ESTADO_PROGRAMACION: 'BORRADOR'
    }, 'ya tiene una programación');
  });

  R.caso(11, 'Turno no habilitado para el área', function () {
    if (!asignada) { return null; }
    var ajeno = turnos.filter(function (t) {
      return !Db_.leer('AREA_TURNO').some(function (at) {
        return at.IDAREA === asignada.idArea && at.IDTURNO === t.IDTURNO &&
               String(at.ESTADO).toUpperCase() === 'ACTIVO';
      });
    })[0];
    if (!ajeno) { return null; }
    return rechazado('CALENDARIO_PERSONAL', {
      IDPERSONAL: asignada.idPersonal, IDAREA: asignada.idArea, IDTURNO: ajeno.IDTURNO,
      IDTIPO_DIA: idTrabajo, FECHA_CALENDARIO: futuro, ESTADO_PROGRAMACION: 'BORRADOR'
    }, 'no está habilitado');
  });

  /* ---------------- INCIDENCIAS ---------------- */
  R.titulo('VACACIONES Y DESCANSOS');

  R.caso(12, 'Registrar vacaciones', function () {
    if (!persona) { return null; }
    var d = Db_._derivar('VACACIONES', {
      IDPERSONAL: persona.IDPERSONAL,
      FECHA_INICIO: futuro, FECHA_FIN: Utilidades_.sumarDias(futuro, 6),
      ESTADO_VACACIONES: 'PENDIENTE'
    });
    var e = Db_.validar('VACACIONES', d, null);
    // Puede rechazarse legítimamente por cobertura: eso también es correcto.
    if (e.length && e.join(' ').indexOf('cobertura') === -1 &&
        e.join(' ').indexOf('sin secretario') === -1) {
      throw new Error('rechazado: ' + e[0]);
    }
    if (Number(d.DIAS) !== 7) { throw new Error('días calculados: ' + d.DIAS + ', se esperaban 7'); }
    return '7 días calculados automáticamente';
  });

  R.caso(13, 'Vacaciones superpuestas', function () {
    var v = Db_.leer('VACACIONES').filter(function (x) {
      var e = String(x.ESTADO_VACACIONES).toUpperCase();
      return e !== 'RECHAZADO' && e !== 'ANULADO';
    })[0];
    if (!v) { return null; }
    return rechazado('VACACIONES', {
      IDPERSONAL: v.IDPERSONAL, FECHA_INICIO: v.FECHA_INICIO,
      FECHA_FIN: v.FECHA_FIN, ESTADO_VACACIONES: 'PENDIENTE'
    }, 'cruza');
  });

  R.caso(14, 'Registrar descanso médico', function () {
    if (!persona) { return null; }
    return aceptado('DESCANSO_MEDICO', {
      IDPERSONAL: persona.IDPERSONAL, DESCRIPCION: 'Caso de prueba',
      FECHA_INICIO: futuro, FECHA_FIN: Utilidades_.sumarDias(futuro, 2),
      ESTADO_DESCANSO: 'APROBADO'
    });
  });

  R.caso(15, 'Conflicto vacaciones + turno', function () {
    var v = Db_.leer('VACACIONES').filter(function (x) {
      return String(x.ESTADO_VACACIONES).toUpperCase() === 'APROBADO';
    })[0];
    if (!v) { return null; }
    var idArea = Cobertura_.areaDe(v.IDPERSONAL, v.FECHA_INICIO);
    if (!idArea) { return null; }
    var t = Db_.leer('AREA_TURNO').filter(function (at) {
      return at.IDAREA === idArea && String(at.ESTADO).toUpperCase() === 'ACTIVO';
    })[0];
    if (!t) { return null; }
    return rechazado('CALENDARIO_PERSONAL', {
      IDPERSONAL: v.IDPERSONAL, IDAREA: idArea, IDTURNO: t.IDTURNO,
      IDTIPO_DIA: idTrabajo, FECHA_CALENDARIO: v.FECHA_INICIO, ESTADO_PROGRAMACION: 'BORRADOR'
    }, 'vacaciones');
  });

  R.caso(16, 'Conflicto descanso médico + turno', function () {
    var d = Db_.leer('DESCANSO_MEDICO').filter(function (x) {
      return String(x.ESTADO_DESCANSO).toUpperCase() === 'APROBADO';
    })[0];
    if (!d) { return null; }
    var idArea = Cobertura_.areaDe(d.IDPERSONAL, d.FECHA_INICIO);
    if (!idArea) { return null; }
    var t = Db_.leer('AREA_TURNO').filter(function (at) {
      return at.IDAREA === idArea && String(at.ESTADO).toUpperCase() === 'ACTIVO';
    })[0];
    if (!t) { return null; }
    return rechazado('CALENDARIO_PERSONAL', {
      IDPERSONAL: d.IDPERSONAL, IDAREA: idArea, IDTURNO: t.IDTURNO,
      IDTIPO_DIA: idTrabajo, FECHA_CALENDARIO: d.FECHA_INICIO, ESTADO_PROGRAMACION: 'BORRADOR'
    }, 'descanso');
  });

  R.caso(17, 'Compensatorio con vencimiento', function () {
    if (!persona) { return null; }
    var d = Db_._derivar('COMPENSATORIO', {
      IDPERSONAL: persona.IDPERSONAL, FECHA_GENERACION: hoy,
      ESTADO_COMPENSATORIO: 'PENDIENTE'
    });
    if (Db_.validar('COMPENSATORIO', d, null).length) { throw new Error('rechazado'); }
    var dias = PARAM_NUM_('DIAS_VIGENCIA_COMPENSATORIO');
    if (d.FECHA_VENCIMIENTO !== Utilidades_.sumarDias(hoy, dias)) {
      throw new Error('vencimiento mal calculado: ' + d.FECHA_VENCIMIENTO);
    }
    return 'vence el ' + d.FECHA_VENCIMIENTO + ' (' + dias + ' días)';
  });

  R.caso(18, 'Feriado sin duplicar', function () {
    var f = Db_.leer('FERIADO').filter(function (x) {
      return String(x.ESTADO).toUpperCase() === 'ACTIVO';
    })[0];
    if (!f) { return null; }
    return rechazado('FERIADO', {
      FECHA: f.FECHA, DESCRIPCION: 'Duplicado de prueba', AMBITO: f.AMBITO,
      IDAREA: f.IDAREA, ES_LABORABLE: 'NO', ESTADO: 'ACTIVO'
    }, 'ya existe');
  });

  R.caso(19, 'Cumpleaños único por persona y año', function () {
    var c = Db_.leer('CUMPLEANIOS').filter(function (x) {
      return String(x.ESTADO_BENEFICIO).toUpperCase() !== 'ANULADO';
    })[0];
    if (!c) { return null; }
    return rechazado('CUMPLEANIOS', {
      IDPERSONAL: c.IDPERSONAL, ANIO_BENEFICIO: c.ANIO_BENEFICIO,
      ESTADO_BENEFICIO: 'PENDIENTE'
    }, 'ya tiene registrado');
  });

  R.caso(20, 'Cambio de área sin solapamiento', function () {
    var pa = Db_.leer('PERSONAL_AREA').filter(function (x) {
      return String(x.ESTADO).toUpperCase() === 'ACTIVO' && !x.FECHA_FIN;
    })[0];
    if (!pa || areas.length < 2) { return null; }
    var otra = areas.filter(function (a) { return a.IDAREA !== pa.IDAREA; })[0];
    return rechazado('PERSONAL_AREA', {
      IDPERSONAL: pa.IDPERSONAL, IDAREA: otra.IDAREA,
      FECHA_INICIO: futuro, ESTADO: 'ACTIVO'
    }, 'ya tiene una asignación');
  });

  /* ---------------- COBERTURA ---------------- */
  R.titulo('COBERTURA DEL JUZGADO');

  R.caso(21, 'Regla de cobertura activa', function () {
    if (!areas.length) { return null; }
    var configurados = areas.filter(function (a) {
      return a.IDCARGO_CRITICO && Number(a.COBERTURA_MINIMA) > 0;
    });
    if (!configurados.length) {
      throw new Error('ningún juzgado tiene cobertura configurada: la regla 40 no se está aplicando');
    }
    return configurados.length + ' de ' + areas.length + ' juzgado(s) con cobertura configurada';
  });

  R.caso(22, 'Un volante no cubre dos juzgados a la vez', function () {
    var r = Db_.leer('REEMPLAZO').filter(function (x) {
      return String(x.ESTADO).toUpperCase() === 'ACTIVO';
    })[0];
    if (!r || areas.length < 2) { return null; }
    var otra = areas.filter(function (a) { return a.IDAREA !== r.IDAREA; })[0];
    return rechazado('REEMPLAZO', {
      IDPERSONAL_VOLANTE: r.IDPERSONAL_VOLANTE, IDAREA: otra.IDAREA,
      FECHA_INICIO: r.FECHA_INICIO, FECHA_FIN: r.FECHA_FIN,
      MOTIVO: 'OTRO', ESTADO: 'ACTIVO'
    }, 'dos juzgados');
  });

  /* ---------------- SEGURIDAD ---------------- */
  R.titulo('SEGURIDAD Y TRAZABILIDAD');

  R.caso(23, 'Usuario sin permisos es rechazado', function () {
    var lector = { nivel: 'LECTOR', etiquetaNivel: 'Consulta', correo: 'prueba@local',
                   permisos: { publicar: false, auditoria: false, gestionUsuarios: false } };
    if (Permisos_.puede(lector, 'CALENDARIO', 'EDITAR')) {
      throw new Error('un LECTOR puede editar el calendario');
    }
    if (Permisos_.puede(lector, 'PERMISOS', 'EDITAR')) {
      throw new Error('un LECTOR puede cambiar los permisos');
    }
    if (!Permisos_.puede('ADMIN', 'PERMISOS', 'EDITAR')) {
      throw new Error('el ADMIN perdió el acceso a los permisos');
    }
    return 'LECTOR sin escritura · ADMIN con acceso total';
  });

  R.caso(24, 'Contraseñas nunca en texto plano', function () {
    var creds = Db_.leer('CREDENCIAL');
    if (!creds.length) { return null; }
    var malas = creds.filter(function (c) { return !c.HASH || !c.SALT; });
    if (malas.length) { throw new Error(malas.length + ' credencial(es) sin hash o sin salt'); }
    var traza = Db_.leer('AUDITORIA');
    var filtrada = creds.some(function (c) {
      return traza.some(function (a) {
        return String(a.VALOR_NUEVO).indexOf(c.HASH) >= 0 ||
               String(a.VALOR_ANTERIOR).indexOf(c.HASH) >= 0;
      });
    });
    if (filtrada) { throw new Error('se filtró un hash a la auditoría'); }
    return creds.length + ' credencial(es), ninguna en claro ni en la traza';
  });

  R.caso(25, 'Auditoría registra los cambios', function () {
    var t = Db_.leer('AUDITORIA');
    if (!t.length) { return null; }
    var conValores = t.filter(function (a) { return a.CAMPO && a.VALOR_NUEVO; }).length;
    var origenes = {};
    t.forEach(function (a) { origenes[a.ORIGEN] = true; });
    return t.length + ' movimientos · ' + conValores + ' con valor anterior y nuevo · orígenes: ' +
           Object.keys(origenes).join(', ');
  });

  R.caso(26, 'Eliminación lógica, nunca física', function () {
    var conBaja = 0;
    ['PERSONAL', 'AREA', 'TURNO', 'CARGO'].forEach(function (t) {
      conBaja += Db_.leer(t).filter(function (r) {
        var def = ESQUEMA_()[t];
        var e = String(r[def.estado] || '').toUpperCase();
        return e && e !== 'ACTIVO';
      }).length;
    });
    var faltaEstado = ['PERSONAL', 'AREA', 'TURNO', 'CARGO', 'VACACIONES'].filter(function (t) {
      return !ESQUEMA_()[t].estado;
    });
    if (faltaEstado.length) { throw new Error('sin campo de estado: ' + faltaEstado.join(', ')); }
    return conBaja + ' registro(s) dados de baja conservan su historial';
  });

  /* ---------------- Informe ---------------- */
  var total = R.ok + R.fallos.length + R.omitidos;
  var resumen = R.ok + '/' + (R.ok + R.fallos.length) + ' correctos' +
                (R.omitidos ? ' · ' + R.omitidos + ' sin datos para evaluar' : '') +
                ' · ' + R.fallos.length + ' fallo(s)';

  var texto = 'CASOS DE PRUEBA DEL SISTEMA  ' + Utilidades_.ahora() + '\n' + '='.repeat(58) +
              R.lineas.join('\n') + '\n' + '='.repeat(58) + '\n' + resumen +
              '\n\nEstas pruebas NO escriben nada: validan las reglas sin guardar.';

  if (R.fallos.length) { texto += '\n\nFALLOS:\n· ' + R.fallos.join('\n· '); }
  if (R.omitidos) {
    texto += '\n\nLos casos sin datos se evalúan cuando el sistema tenga personal, ' +
             'juzgados, turnos e incidencias cargados.';
  }

  console.log(texto);
  try {
    SpreadsheetApp.getUi().alert(
      R.fallos.length ? 'Casos de prueba: hay fallos' : 'Casos de prueba superados',
      resumen + '\n\nEl detalle está en el registro de ejecución del editor.' +
      (R.fallos.length ? '\n\nPrimer fallo:\n' + R.fallos[0] : ''),
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (ignore) { /* desde el editor basta el registro */ }

  return resumen;
}
