/**
 * 16_Panel.gs
 * Dashboard: la pantalla de inicio.
 *
 * Responde de un vistazo las preguntas del día a día: quién está de servicio hoy,
 * qué juzgado se queda corto, qué vence esta semana y qué falta por programar.
 *
 * Toda la información se arma con una sola pasada por cada tabla. Recalcular por
 * indicador multiplicaría las lecturas de la hoja y el panel tardaría segundos.
 */

var Panel_ = {

  /** Datos completos del dashboard, filtrados por lo que el usuario puede ver. */
  resumen: function (ctx, opciones) {
    opciones = opciones || {};
    var hoy = opciones.fecha ? Utilidades_.aISO(opciones.fecha) : Utilidades_.hoyISO();
    var mes = hoy.substring(0, 7);
    var finMes = Utilidades_.diasDelMes(Number(hoy.substring(0, 4)), Number(hoy.substring(5, 7)));
    var inicioMes = finMes[0], ultimoMes = finMes[finMes.length - 1];
    var horizonte = Utilidades_.sumarDias(hoy, 7);

    var puedeIncidencias = Permisos_.puede(ctx, 'INCIDENCIAS', 'VER');
    var puedeCobertura = Permisos_.puede(ctx, 'COBERTURA', 'VER');

    // --- Una sola lectura de cada tabla
    var personal = Db_.leer('PERSONAL');
    var areas = Db_.leer('AREA').filter(function (a) {
      return String(a.ESTADO_AREA).toUpperCase() === 'ACTIVO';
    });
    var calendario = Db_.leer('CALENDARIO_PERSONAL');
    var turnos = {};
    Db_.leer('TURNO').forEach(function (t) { turnos[t.IDTURNO] = t; });
    var tiposDia = {};
    Db_.leer('TIPO_DIA').forEach(function (t) { tiposDia[t.IDTIPO_DIA] = String(t.TIPO_DIA).toUpperCase(); });
    var funciones = {};
    Db_.leer('FUNCION').forEach(function (f) { funciones[f.IDFUNCION] = f; });

    var nombre = {}, activo = {}, cargoDe = {};
    personal.forEach(function (p) {
      nombre[p.IDPERSONAL] = p.APELLIDOS + ', ' + p.NOMBRES;
      activo[p.IDPERSONAL] = String(p.ESTADO_PERSONAL).toUpperCase() === 'ACTIVO' &&
                             (!p.FECHA_CESE || p.FECHA_CESE >= hoy);
      cargoDe[p.IDPERSONAL] = p.IDCARGO;
    });

    var nombreArea = {};
    areas.forEach(function (a) { nombreArea[a.IDAREA] = a.AREA; });

    // --- Personal
    var personalActivo = personal.filter(function (p) {
      return String(p.ESTADO_PERSONAL).toUpperCase() === 'ACTIVO';
    }).length;
    var personalInactivo = personal.length - personalActivo;

    // --- Programación de hoy
    var deHoy = calendario.filter(function (r) {
      return r.FECHA_CALENDARIO === hoy &&
             String(r.ESTADO_PROGRAMACION).toUpperCase() !== 'ANULADO';
    });
    var trabajanHoy = deHoy.filter(function (r) { return tiposDia[r.IDTIPO_DIA] === 'TRABAJO'; });

    // --- Ausencias de hoy y del mes
    var mapaHoy = Reglas_.mapaAusencias(hoy, hoy);
    var conteoHoy = { VACACIONES: 0, DESCANSO_MEDICO: 0, LICENCIA: 0, COMPENSATORIO: 0, CUMPLEANIOS: 0 };
    var ausentesHoy = [];
    Object.keys(mapaHoy).forEach(function (idp) {
      var a = mapaHoy[idp][hoy];
      if (!a || a.nivel !== 'BLOQUEO') { return; }
      if (conteoHoy[a.tipo] !== undefined) { conteoHoy[a.tipo]++; }
      ausentesHoy.push({ persona: nombre[idp] || idp, tipo: a.tipo, detalle: a.detalle });
    });

    // --- Compensatorios
    var compPendientes = 0, compPorVencer = [];
    var limiteAviso = Utilidades_.sumarDias(hoy, PARAM_NUM_('DIAS_AVISO_VENCIMIENTO'));
    if (puedeIncidencias) {
      Db_.leer('COMPENSATORIO').forEach(function (c) {
        var e = String(c.ESTADO_COMPENSATORIO).toUpperCase();
        if (e !== 'PENDIENTE' && e !== 'PROGRAMADO') { return; }
        compPendientes++;
        if (c.FECHA_VENCIMIENTO && c.FECHA_VENCIMIENTO <= limiteAviso) {
          compPorVencer.push({
            persona: nombre[c.IDPERSONAL] || c.IDPERSONAL,
            vence: c.FECHA_VENCIMIENTO,
            fecha: c.FECHA_COMPENSATORIO || '',
            estado: c.ESTADO_COMPENSATORIO,
            diasRestantes: Utilidades_.diasEntre(hoy, c.FECHA_VENCIMIENTO) - 1
          });
        }
      });
      compPorVencer.sort(function (a, b) { return a.vence.localeCompare(b.vence); });
    }

    // --- Cumpleaños del mes
    var cumples = [];
    if (puedeIncidencias) {
      personal.forEach(function (p) {
        if (!activo[p.IDPERSONAL] || !p.FECHA_NAC) { return; }
        if (String(p.FECHA_NAC).substring(5, 7) !== hoy.substring(5, 7)) { return; }
        cumples.push({
          persona: nombre[p.IDPERSONAL],
          dia: Number(String(p.FECHA_NAC).substring(8, 10)),
          fecha: hoy.substring(0, 5) + String(p.FECHA_NAC).substring(5, 10),
          esHoy: String(p.FECHA_NAC).substring(5, 10) === hoy.substring(5, 10)
        });
      });
      cumples.sort(function (a, b) { return a.dia - b.dia; });
    }

    // --- Turnos de hoy: quién cubre cada turno y en qué juzgado
    var porTurno = {};
    trabajanHoy.forEach(function (r) {
      var t = turnos[r.IDTURNO];
      var clave = r.IDTURNO || 'SIN_TURNO';
      if (!porTurno[clave]) {
        porTurno[clave] = {
          turno: t ? t.NOMBRE_TURNO : 'Sin turno asignado',
          inicio: t ? t.HORA_INICIO : '', fin: t ? t.HORA_FIN : '',
          cruza: t ? String(t.CRUZA_MEDIANOCHE).toUpperCase() === 'SI' : false,
          personas: []
        };
      }
      porTurno[clave].personas.push({
        persona: nombre[r.IDPERSONAL] || r.IDPERSONAL,
        juzgado: nombreArea[r.IDAREA] || r.IDAREA,
        funcion: r.IDFUNCION && funciones[r.IDFUNCION] ? funciones[r.IDFUNCION].ABREVIATURA : ''
      });
    });
    var turnosHoy = Object.keys(porTurno).map(function (k) { return porTurno[k]; })
      .sort(function (a, b) { return String(a.inicio).localeCompare(String(b.inicio)); });

    // --- Resumen por juzgado
    var programadosMes = {};
    calendario.forEach(function (r) {
      if (r.FECHA_CALENDARIO.substring(0, 7) !== mes) { return; }
      if (String(r.ESTADO_PROGRAMACION).toUpperCase() === 'ANULADO') { return; }
      programadosMes[r.IDAREA] = (programadosMes[r.IDAREA] || 0) + 1;
    });

    var resumenAreas = areas.map(function (a) {
      var plantilla = Reglas_.personalDeArea(a.IDAREA, hoy, hoy);
      var trabajan = trabajanHoy.filter(function (r) { return r.IDAREA === a.IDAREA; }).length;
      var riesgo = 0;
      if (puedeCobertura) {
        var cob = Cobertura_.panel(a.IDAREA, hoy, horizonte);
        riesgo = cob.controla ? cob.diasEnRiesgo : 0;
      }
      return {
        idArea: a.IDAREA, juzgado: a.AREA,
        plantilla: plantilla.length,
        trabajanHoy: trabajan,
        diasProgramadosMes: programadosMes[a.IDAREA] || 0,
        diasEnRiesgo: riesgo,
        deTurno: Reglas_.juzgadoDeTurno(a.IDAREA, hoy)
      };
    });

    // --- Alertas
    var alertas = this._alertas(ctx, {
      hoy: hoy, horizonte: horizonte, inicioMes: inicioMes, ultimoMes: ultimoMes,
      areas: areas, resumenAreas: resumenAreas, compPorVencer: compPorVencer,
      personal: personal, activo: activo, nombre: nombre,
      puedeIncidencias: puedeIncidencias, puedeCobertura: puedeCobertura
    });

    return {
      fecha: hoy,
      diaSemana: Utilidades_.diaSemana(hoy),
      indicadores: {
        personalActivo: personalActivo,
        personalInactivo: personalInactivo,
        programadosHoy: trabajanHoy.length,
        vacacionesHoy: conteoHoy.VACACIONES,
        descansoMedicoHoy: conteoHoy.DESCANSO_MEDICO,
        licenciaHoy: conteoHoy.LICENCIA,
        compensatorioHoy: conteoHoy.COMPENSATORIO,
        compensatoriosPendientes: compPendientes,
        cumpleanosMes: cumples.length,
        juzgadosActivos: areas.length,
        incidenciasHoy: ausentesHoy.length,
        alertas: alertas.length
      },
      turnosHoy: turnosHoy,
      ausentesHoy: ausentesHoy,
      cumples: cumples,
      compensatoriosPorVencer: compPorVencer.slice(0, 12),
      resumenAreas: resumenAreas,
      alertas: alertas,
      permisos: { incidencias: puedeIncidencias, cobertura: puedeCobertura }
    };
  },

  /**
   * Alertas ordenadas por gravedad. Solo lo accionable: una alerta que nadie
   * puede resolver es ruido que hace ignorar las que sí importan.
   */
  _alertas: function (ctx, d) {
    var lista = [];

    // Juzgados que se quedan sin cobertura en los próximos días
    if (d.puedeCobertura) {
      d.resumenAreas.forEach(function (a) {
        if (!a.diasEnRiesgo) { return; }
        lista.push({
          nivel: 'ALTA', tipo: 'COBERTURA',
          texto: a.juzgado + ' queda sin cobertura ' + a.diasEnRiesgo +
                 ' día(s) en la próxima semana.',
          accion: 'cobertura'
        });
      });
    }

    // Compensatorios que vencen o ya vencieron
    d.compPorVencer.forEach(function (c) {
      if (c.diasRestantes < 0) {
        lista.push({ nivel: 'ALTA', tipo: 'COMPENSATORIO',
          texto: 'El compensatorio de ' + c.persona + ' venció el ' + c.vence + '.',
          accion: 'incidencias' });
      } else if (c.diasRestantes <= 3) {
        lista.push({ nivel: 'MEDIA', tipo: 'COMPENSATORIO',
          texto: 'A ' + c.persona + ' le quedan ' + c.diasRestantes +
                 ' día(s) para usar su compensatorio.',
          accion: 'incidencias' });
      }
    });

    // Juzgados sin turnos habilitados
    var conTurno = {};
    Db_.leer('AREA_TURNO').forEach(function (at) {
      if (String(at.ESTADO).toUpperCase() === 'ACTIVO') { conTurno[at.IDAREA] = true; }
    });
    d.areas.forEach(function (a) {
      if (conTurno[a.IDAREA]) { return; }
      lista.push({ nivel: 'ALTA', tipo: 'CONFIGURACION',
        texto: a.AREA + ' no tiene turnos habilitados: no se puede programar trabajo ahí.',
        accion: 'maestros' });
    });

    // Juzgados sin control de cobertura configurado
    d.areas.forEach(function (a) {
      if (a.IDCARGO_CRITICO) { return; }
      lista.push({ nivel: 'MEDIA', tipo: 'CONFIGURACION',
        texto: a.AREA + ' no tiene cargo crítico definido: la regla de cobertura no se aplica.',
        accion: 'maestros' });
    });

    // Personal activo sin juzgado asignado
    var asignados = {};
    Db_.leer('PERSONAL_AREA').forEach(function (pa) {
      if (String(pa.ESTADO).toUpperCase() !== 'ACTIVO') { return; }
      if (pa.FECHA_FIN && pa.FECHA_FIN < d.hoy) { return; }
      asignados[pa.IDPERSONAL] = true;
    });
    var sinArea = d.personal.filter(function (p) {
      return d.activo[p.IDPERSONAL] && !asignados[p.IDPERSONAL];
    });
    if (sinArea.length) {
      lista.push({ nivel: 'MEDIA', tipo: 'PERSONAL',
        texto: sinArea.length + ' persona(s) activas sin juzgado asignado: ' +
               sinArea.slice(0, 3).map(function (p) { return d.nombre[p.IDPERSONAL]; }).join(', ') +
               (sinArea.length > 3 ? '…' : ''),
        accion: 'personal' });
    }

    // Días del mes sin programar por juzgado
    d.resumenAreas.forEach(function (a) {
      if (!a.plantilla) { return; }
      var esperados = a.plantilla * Utilidades_.diasEntre(d.inicioMes, d.ultimoMes);
      if (a.diasProgramadosMes >= esperados) { return; }
      var faltan = esperados - a.diasProgramadosMes;
      lista.push({ nivel: a.diasProgramadosMes === 0 ? 'ALTA' : 'BAJA', tipo: 'PROGRAMACION',
        texto: a.diasProgramadosMes === 0
          ? a.juzgado + ' no tiene nada programado este mes.'
          : 'A ' + a.juzgado + ' le faltan ' + faltan + ' día-persona por programar este mes.',
        accion: 'programar' });
    });

    var orden = { ALTA: 1, MEDIA: 2, BAJA: 3 };
    lista.sort(function (a, b) { return orden[a.nivel] - orden[b.nivel]; });
    return lista;
  }
};
