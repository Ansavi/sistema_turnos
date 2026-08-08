/**
 * 07_Calendario.gs
 * Arma el tablero mensual por área: personas en filas, días en columnas,
 * con las ausencias ya resueltas para que el programador no tenga que revisarlas a mano.
 */

var Calendario_ = {

  /** Tablero completo listo para pintar en la web. */
  tablero: function (ctx, idArea, anio, mes) {
    Auth_.exigirLectura(ctx, 'CALENDARIO_PERSONAL');

    var dias = Utilidades_.diasDelMes(anio, mes);
    var desde = dias[0], hasta = dias[dias.length - 1];

    var personal = Reglas_.personalDeArea(idArea, desde, hasta);
    var turnos = Reglas_.turnosDeArea(idArea);
    var mapa = Reglas_.mapaAusencias(desde, hasta);

    var tipos = {};
    var defsSistema = TIPOS_DIA_SISTEMA_();
    Db_.leer('TIPO_DIA').forEach(function (t) {
      var nombre = String(t.TIPO_DIA).toUpperCase();
      tipos[t.IDTIPO_DIA] = {
        id: t.IDTIPO_DIA, nombre: nombre,
        color: (defsSistema[nombre] || {}).color || '#4A5568',
        bloquea: (defsSistema[nombre] || {}).bloquea || false,
        activo: String(t.ESTADO_TIPO).toUpperCase() === 'ACTIVO'
      };
    });

    var feriados = Reglas_.mapaFeriados(idArea, desde, hasta);
    var cobertura = Cobertura_.panel(idArea, desde, hasta);

    var programado = {};
    Db_.leer('CALENDARIO_PERSONAL').forEach(function (r) {
      if (r.IDAREA !== idArea) { return; }
      if (r.FECHA_CALENDARIO < desde || r.FECHA_CALENDARIO > hasta) { return; }
      if (String(r.ESTADO_PROGRAMACION).toUpperCase() === 'ANULADO') { return; }
      if (!programado[r.IDPERSONAL]) { programado[r.IDPERSONAL] = {}; }
      programado[r.IDPERSONAL][r.FECHA_CALENDARIO] = r;
    });

    var filas = personal.map(function (p) {
      var celdas = dias.map(function (f) {
        var reg = programado[p.IDPERSONAL] && programado[p.IDPERSONAL][f];
        var au = mapa[p.IDPERSONAL] && mapa[p.IDPERSONAL][f];
        var fer = feriados[f] || null;
        var cesado = p.cese && f > p.cese;
        var fueraDeAsignacion = (p.desde && f < p.desde) || (p.hasta && f > p.hasta) || cesado;

        var motivo = '';
        if (cesado) { motivo = 'Cesó el ' + p.cese; }
        else if (fueraDeAsignacion) { motivo = 'Fuera del periodo de asignación al juzgado'; }
        else if (au) { motivo = au.detalle; }
        else if (fer && !fer.esLaborable) { motivo = 'Feriado: ' + fer.descripcion; }

        return {
          fecha: f,
          id: reg ? reg.IDCALENDARIO_PERSONAL : '',
          idTipoDia: reg ? reg.IDTIPO_DIA : '',
          tipo: reg && tipos[reg.IDTIPO_DIA] ? tipos[reg.IDTIPO_DIA].nombre : '',
          idTurno: reg ? reg.IDTURNO : '',
          estado: reg ? reg.ESTADO_PROGRAMACION : '',
          inicio: reg && reg.INICIO_PROGRAMADO ? reg.INICIO_PROGRAMADO.substring(11, 16) : '',
          fin: reg && reg.FIN_PROGRAMADO ? reg.FIN_PROGRAMADO.substring(11, 16) : '',
          cruzaDia: !!(reg && reg.FIN_PROGRAMADO &&
                       reg.FIN_PROGRAMADO.substring(0, 10) !== f),
          version: reg ? Number(reg.VERSION || 1) : 0,
          observaciones: reg ? reg.OBSERVACIONES : '',
          ausencia: au || null,
          feriado: fer,
          bloqueada: fueraDeAsignacion || (au && au.nivel === 'BLOQUEO') || false,
          motivo: motivo
        };
      });
      return { idPersonal: p.IDPERSONAL, persona: p.nombre, idCargo: p.IDCARGO, celdas: celdas };
    });

    return {
      idArea: idArea, anio: anio, mes: mes, dias: dias,
      diasSemana: dias.map(function (f) { return Utilidades_.diaSemana(f).substring(0, 3); }),
      finDeSemana: dias.map(function (f) { return Utilidades_.esFinDeSemana(f); }),
      turnos: turnos.map(function (t) {
        return { id: t.IDTURNO, nombre: t.NOMBRE_TURNO, inicio: t.HORA_INICIO,
                 fin: t.HORA_FIN, tipo: t.TIPO_TURNO,
                 cruza: String(t.CRUZA_MEDIANOCHE).toUpperCase() === 'SI',
                 duracion: Number(t.DURACION_HORAS) || 0 };
      }),
      tiposDia: Object.keys(tipos).map(function (k) { return tipos[k]; })
                  .filter(function (t) { return t.activo; }),
      filas: filas,
      resumen: this._resumen(filas, tipos),
      feriados: Object.keys(feriados).map(function (f) {
        return { fecha: f, descripcion: feriados[f].descripcion,
                 esLaborable: feriados[f].esLaborable, deTurno: feriados[f].deTurno };
      }),
      cobertura: cobertura,
      advertencias: Reglas_.advertenciasDeMes(idArea, anio, mes),
      puedeEditar: Auth_.puedeEscribir(ctx, 'CALENDARIO_PERSONAL'),
      puedePublicar: !!ctx.permisos.publicar
    };
  },

  _resumen: function (filas, tipos) {
    var conteo = {};
    filas.forEach(function (f) {
      f.celdas.forEach(function (c) {
        if (!c.tipo) { return; }
        conteo[c.tipo] = (conteo[c.tipo] || 0) + 1;
      });
    });
    return Object.keys(conteo).map(function (k) {
      var color = '#4A5568';
      Object.keys(tipos).forEach(function (id) { if (tipos[id].nombre === k) { color = tipos[id].color; } });
      return { tipo: k, total: conteo[k], color: color };
    }).sort(function (a, b) { return b.total - a.total; });
  },

  /**
   * Guarda varias celdas de una vez. Cada cambio pasa por Db_ y queda auditado.
   * celdas: [{idPersonal, fecha, idTipoDia, idTurno, observaciones, id}]
   */
  guardarLote: function (ctx, idArea, celdas) {
    Auth_.exigirEscritura(ctx, 'CALENDARIO_PERSONAL');
    var ok = 0, fallos = [];

    celdas.forEach(function (c) {
      try {
        var datos = {
          IDPERSONAL: c.idPersonal,
          IDAREA: idArea,
          IDTURNO: c.idTurno || '',
          IDTIPO_DIA: c.idTipoDia,
          FECHA_CALENDARIO: c.fecha,
          ESTADO_PROGRAMACION: 'BORRADOR',
          OBSERVACIONES: c.observaciones || ''
        };
        if (c.id) {
          var actual = Db_.buscarPorId('CALENDARIO_PERSONAL', c.id);
          datos.ESTADO_PROGRAMACION = actual ? actual.ESTADO_PROGRAMACION : 'BORRADOR';
          Db_.actualizar('CALENDARIO_PERSONAL', c.id, datos, ctx);
        } else {
          var existente = Calendario_._buscarCelda(c.idPersonal, c.fecha);
          if (existente) { Db_.actualizar('CALENDARIO_PERSONAL', existente.IDCALENDARIO_PERSONAL, datos, ctx); }
          else { Db_.insertar('CALENDARIO_PERSONAL', datos, ctx); }
        }
        ok++;
      } catch (err) {
        fallos.push({ idPersonal: c.idPersonal, fecha: c.fecha, error: err.message });
      }
    });

    return { guardados: ok, fallos: fallos };
  },

  limpiarCelda: function (ctx, id) {
    Auth_.exigirEscritura(ctx, 'CALENDARIO_PERSONAL');
    return Db_.anular('CALENDARIO_PERSONAL', id, ctx);
  },

  _buscarCelda: function (idPersonal, fecha) {
    var f = Db_.leer('CALENDARIO_PERSONAL').filter(function (r) {
      return r.IDPERSONAL === idPersonal && r.FECHA_CALENDARIO === fecha &&
             String(r.ESTADO_PROGRAMACION).toUpperCase() !== 'ANULADO';
    });
    return f.length ? f[0] : null;
  },

  /**
   * Rellena automáticamente el mes: marca las ausencias aprobadas con su tipo de día
   * y deja el resto en TRABAJO con el turno indicado. No pisa lo ya programado.
   */
  prellenarMes: function (ctx, idArea, anio, mes, idTurnoBase) {
    Auth_.exigirEscritura(ctx, 'CALENDARIO_PERSONAL');
    var dias = Utilidades_.diasDelMes(anio, mes);
    var desde = dias[0], hasta = dias[dias.length - 1];
    var mapa = Reglas_.mapaAusencias(desde, hasta);
    var feriadosMes = Reglas_.mapaFeriados(idArea, desde, hasta);
    var personal = Reglas_.personalDeArea(idArea, desde, hasta);

    var idTrabajo = Reglas_.idTipoDia('TRABAJO');
    var idDescanso = Reglas_.idTipoDia('DESCANSO');
    var pendientes = [];

    personal.forEach(function (p) {
      dias.forEach(function (f) {
        if (Calendario_._buscarCelda(p.IDPERSONAL, f)) { return; }
        if (p.desde && f < p.desde) { return; }
        if (p.hasta && f > p.hasta) { return; }

        var au = mapa[p.IDPERSONAL] && mapa[p.IDPERSONAL][f];
        var fer = feriadosMes[f];
        if (au && au.nivel === 'BLOQUEO') {
          pendientes.push({ idPersonal: p.IDPERSONAL, fecha: f,
            idTipoDia: Reglas_.idTipoDia(au.tipo), idTurno: '',
            observaciones: 'Automático: ' + au.detalle });
        } else if (fer && !fer.esLaborable) {
          // Regla 45: solo libera si el juzgado no está de turno esa fecha.
          pendientes.push({ idPersonal: p.IDPERSONAL, fecha: f,
            idTipoDia: Reglas_.idTipoDia('FERIADO'), idTurno: '',
            observaciones: 'Automático: ' + fer.descripcion });
        } else if (Utilidades_.esFinDeSemana(f)) {
          pendientes.push({ idPersonal: p.IDPERSONAL, fecha: f, idTipoDia: idDescanso,
            idTurno: '', observaciones: 'Automático: descanso de fin de semana' });
        } else if (idTurnoBase) {
          pendientes.push({ idPersonal: p.IDPERSONAL, fecha: f, idTipoDia: idTrabajo,
            idTurno: idTurnoBase, observaciones: '' });
        }
      });
    });

    var res = this.guardarLote(ctx, idArea, pendientes);
    Auditoria_.registrar(ctx, 'PRELLENAR', 'CALENDARIO_PERSONAL', idArea, '', '',
      anio + '-' + mes, 'OK', 'Celdas generadas: ' + res.guardados);
    return res;
  },

  /** Pasa el mes de BORRADOR a PUBLICADO. Solo supervisor o administrador. */
  publicarMes: function (ctx, idArea, anio, mes) {
    Auth_.exigirPublicacion(ctx);
    var dias = Utilidades_.diasDelMes(anio, mes);
    var desde = dias[0], hasta = dias[dias.length - 1];
    var n = 0;

    Db_.leer('CALENDARIO_PERSONAL').forEach(function (r) {
      if (r.IDAREA !== idArea) { return; }
      if (r.FECHA_CALENDARIO < desde || r.FECHA_CALENDARIO > hasta) { return; }
      if (String(r.ESTADO_PROGRAMACION).toUpperCase() !== 'BORRADOR') { return; }
      Db_.actualizar('CALENDARIO_PERSONAL', r.IDCALENDARIO_PERSONAL,
        { ESTADO_PROGRAMACION: 'PUBLICADO' }, ctx);
      n++;
    });

    Auditoria_.registrar(ctx, 'PUBLICAR', 'CALENDARIO_PERSONAL', idArea, '', 'BORRADOR',
      'PUBLICADO', 'OK', 'Área ' + idArea + ' periodo ' + anio + '-' + mes + ', registros: ' + n);
    return { publicados: n };
  }
};

/**
 * Genera el beneficio de cumpleaños del año en curso para todo el personal activo.
 * Se puede ejecutar desde el menú de la hoja o con un trigger anual.
 */
function generarCumpleaniosDelAnio() {
  var ctx = { correo: Session.getEffectiveUser().getEmail(), nivel: 'ADMIN', origen: 'PROCESO' };
  var anio = new Date().getFullYear();
  var creados = 0;

  Db_.leer('PERSONAL').forEach(function (p) {
    if (String(p.ESTADO_PERSONAL).toUpperCase() !== 'ACTIVO' || !p.FECHA_NAC) { return; }
    var yaTiene = Db_.leer('CUMPLEANIOS').some(function (c) {
      return c.IDPERSONAL === p.IDPERSONAL && String(c.ANIO_BENEFICIO) === String(anio);
    });
    if (yaTiene) { return; }
    Db_.insertar('CUMPLEANIOS', {
      IDPERSONAL: p.IDPERSONAL,
      FECHA_BENEFICIO: anio + '-' + String(p.FECHA_NAC).substring(5, 10),
      ESTADO_BENEFICIO: 'PENDIENTE',
      ANIO_BENEFICIO: anio,
      OBSERVACIONES: 'Generado automáticamente'
    }, ctx);
    creados++;
  });

  SpreadsheetApp.getActive().toast('Beneficios de cumpleaños creados: ' + creados, CONFIG_().APP, 6);
  return creados;
}
