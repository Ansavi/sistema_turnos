/**
 * 15_Programacion.gs
 * Programación masiva del calendario.
 *
 * Todo pasa por Calendario_.guardarLote, así que cada celda se valida contra las
 * 46 reglas igual que si se hubiera pintado a mano: no hay una vía rápida que se
 * salte la cobertura del juzgado ni los cruces de horario.
 *
 * Cuatro operaciones:
 *   Programacion_.porRango()    - un tipo de día a varias personas y fechas
 *   Programacion_.porPatron()   - un ciclo que se repite (2 de trabajo, 1 de descanso)
 *   Programacion_.copiarMes()   - traslada la programación de un mes a otro
 *   Programacion_.limpiarRango() - anula la programación de un periodo
 */

var Programacion_ = {

  DIAS_SEMANA: ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'],

  /**
   * Contexto común de una operación: personal del juzgado, ausencias, feriados y
   * lo ya programado. Se calcula una vez y se reutiliza para todo el rango, en
   * lugar de releer las hojas en cada día.
   */
  _preparar: function (idArea, desde, hasta) {
    var tipos = {};
    Db_.leer('TIPO_DIA').forEach(function (t) {
      tipos[t.IDTIPO_DIA] = String(t.TIPO_DIA).toUpperCase();
    });

    var ocupado = {};
    Db_.leer('CALENDARIO_PERSONAL').forEach(function (r) {
      if (String(r.ESTADO_PROGRAMACION).toUpperCase() === 'ANULADO') { return; }
      if (r.FECHA_CALENDARIO < desde || r.FECHA_CALENDARIO > hasta) { return; }
      ocupado[r.IDPERSONAL + '|' + r.FECHA_CALENDARIO] = r;
    });

    return {
      tipos: tipos,
      ausencias: Reglas_.mapaAusencias(desde, hasta),
      feriados: Reglas_.mapaFeriados(idArea, desde, hasta),
      personal: Reglas_.personalDeArea(idArea, desde, hasta),
      ocupado: ocupado,
      idFeriado: Reglas_.idTipoDia('FERIADO')
    };
  },

  /** ¿Se puede escribir en esta celda? Devuelve el motivo si no. */
  _evaluarCelda: function (ctx, cfg, p, fecha, nombreTipo) {
    if (p.desde && fecha < p.desde) { return 'fuera del periodo de asignación'; }
    if (p.hasta && fecha > p.hasta) { return 'fuera del periodo de asignación'; }
    if (p.cese && fecha > p.cese) { return 'cesó el ' + p.cese; }

    if (cfg.filtroDias && cfg.filtroDias.length) {
      var dia = Utilidades_.diaSemana(fecha);
      if (cfg.filtroDias.indexOf(dia) === -1) { return null; }   // no aplica, sin aviso
    }

    var yaHay = ctx.ocupado[p.IDPERSONAL + '|' + fecha];
    if (yaHay && !cfg.sobrescribir) { return 'ya estaba programado'; }

    var au = ctx.ausencias[p.IDPERSONAL] && ctx.ausencias[p.IDPERSONAL][fecha];
    if (au && au.nivel === 'BLOQUEO' && nombreTipo === 'TRABAJO') {
      return au.tipo.replace(/_/g, ' ').toLowerCase();
    }
    return 'OK';
  },

  /** Qué debe quedar en esa celda: lo pedido, o lo que impone la ausencia o el feriado. */
  _resolverTipo: function (ctx, cfg, p, fecha) {
    var au = ctx.ausencias[p.IDPERSONAL] && ctx.ausencias[p.IDPERSONAL][fecha];
    if (au && au.nivel === 'BLOQUEO') {
      return { idTipoDia: Reglas_.idTipoDia(au.tipo), idTurno: '', idFuncion: '',
               nota: 'Automático: ' + au.detalle };
    }
    var fer = ctx.feriados[fecha];
    if (fer && !fer.esLaborable) {
      return { idTipoDia: ctx.idFeriado, idTurno: '', idFuncion: '',
               nota: 'Automático: ' + fer.descripcion };
    }
    return null;
  },

  /**
   * Programa un mismo tipo de día para varias personas en un rango de fechas.
   * cfg: { idArea, idsPersonal[], desde, hasta, idTipoDia, idTurno, idFuncion,
   *        filtroDias[], sobrescribir, respetarAusencias }
   */
  porRango: function (ctx, cfg) {
    Auth_.exigirEscritura(ctx, 'CALENDARIO_PERSONAL');

    var desde = Utilidades_.aISO(cfg.desde);
    var hasta = Utilidades_.aISO(cfg.hasta);
    if (!desde || !hasta) { throw new Error('Indica la fecha de inicio y la de fin.'); }
    if (hasta < desde) { throw new Error('La fecha fin no puede ser anterior al inicio.'); }
    if (Utilidades_.diasEntre(desde, hasta) > 366) {
      throw new Error('El rango no puede superar un año.');
    }

    var datos = this._preparar(cfg.idArea, desde, hasta);
    var nombreTipo = datos.tipos[cfg.idTipoDia] || '';
    var personas = this._filtrarPersonal(datos.personal, cfg.idsPersonal);
    if (!personas.length) { throw new Error('No hay personal seleccionado en ese juzgado.'); }

    var celdas = [], omitidas = [];
    var self = this;

    personas.forEach(function (p) {
      var fecha = desde, guarda = 0;
      while (fecha <= hasta && guarda++ < 400) {
        var veredicto = self._evaluarCelda(datos, cfg, p, fecha, nombreTipo);
        if (veredicto === null) { fecha = Utilidades_.sumarDias(fecha, 1); continue; }

        if (veredicto !== 'OK') {
          // Las ausencias y feriados no se saltan: se marcan con su propio tipo.
          var forzado = cfg.respetarAusencias === false ? null : self._resolverTipo(datos, cfg, p, fecha);
          if (forzado && veredicto !== 'ya estaba programado') {
            celdas.push({ idPersonal: p.IDPERSONAL, fecha: fecha,
                          id: (datos.ocupado[p.IDPERSONAL + '|' + fecha] || {}).IDCALENDARIO_PERSONAL || '',
                          idTipoDia: forzado.idTipoDia, idTurno: '', idFuncion: '',
                          observaciones: forzado.nota });
          } else {
            omitidas.push({ persona: p.nombre, fecha: fecha, motivo: veredicto });
          }
          fecha = Utilidades_.sumarDias(fecha, 1);
          continue;
        }

        var forzadoOk = cfg.respetarAusencias === false ? null : self._resolverTipo(datos, cfg, p, fecha);
        celdas.push({
          idPersonal: p.IDPERSONAL, fecha: fecha,
          id: (datos.ocupado[p.IDPERSONAL + '|' + fecha] || {}).IDCALENDARIO_PERSONAL || '',
          idTipoDia: forzadoOk ? forzadoOk.idTipoDia : cfg.idTipoDia,
          idTurno: forzadoOk ? '' : (nombreTipo === 'TRABAJO' ? (cfg.idTurno || '') : ''),
          idFuncion: forzadoOk ? '' : (nombreTipo === 'TRABAJO' ? (cfg.idFuncion || '') : ''),
          observaciones: forzadoOk ? forzadoOk.nota : (cfg.observaciones || '')
        });
        fecha = Utilidades_.sumarDias(fecha, 1);
      }
    });

    return this._guardar(ctx, cfg.idArea, celdas, omitidas, 'PROGRAMAR_RANGO',
      personas.length + ' persona(s), ' + desde + ' a ' + hasta);
  },

  /**
   * Aplica un ciclo que se repite hasta cubrir el rango.
   * Ejemplo de rotación 2-1: [trabajo mañana, trabajo mañana, descanso].
   * cfg: { idArea, idsPersonal[], desde, hasta, patron[], desfase, sobrescribir }
   *
   * `desfase` corre el arranque del ciclo por persona: con desfase 1, la segunda
   * persona empieza en el segundo paso del patrón. Es lo que produce que unos
   * descansen mientras otros trabajan, en lugar de que descansen todos a la vez.
   */
  porPatron: function (ctx, cfg) {
    Auth_.exigirEscritura(ctx, 'CALENDARIO_PERSONAL');

    var desde = Utilidades_.aISO(cfg.desde);
    var hasta = Utilidades_.aISO(cfg.hasta);
    if (!desde || !hasta) { throw new Error('Indica la fecha de inicio y la de fin.'); }
    if (hasta < desde) { throw new Error('La fecha fin no puede ser anterior al inicio.'); }
    if (!cfg.patron || !cfg.patron.length) { throw new Error('Define al menos un paso del ciclo.'); }
    if (cfg.patron.length > 31) { throw new Error('El ciclo no puede tener más de 31 pasos.'); }

    var datos = this._preparar(cfg.idArea, desde, hasta);
    var personas = this._filtrarPersonal(datos.personal, cfg.idsPersonal);
    if (!personas.length) { throw new Error('No hay personal seleccionado en ese juzgado.'); }

    var celdas = [], omitidas = [];
    var desfase = Number(cfg.desfase) || 0;
    var self = this;

    personas.forEach(function (p, indicePersona) {
      var paso = (desfase * indicePersona) % cfg.patron.length;
      var fecha = desde, guarda = 0;

      while (fecha <= hasta && guarda++ < 400) {
        var actual = cfg.patron[paso % cfg.patron.length];
        var nombreTipo = datos.tipos[actual.idTipoDia] || '';
        var veredicto = self._evaluarCelda(datos, cfg, p, fecha, nombreTipo);

        if (veredicto === 'OK' || veredicto === nombreTipo) {
          var forzado = self._resolverTipo(datos, cfg, p, fecha);
          celdas.push({
            idPersonal: p.IDPERSONAL, fecha: fecha,
            id: (datos.ocupado[p.IDPERSONAL + '|' + fecha] || {}).IDCALENDARIO_PERSONAL || '',
            idTipoDia: forzado ? forzado.idTipoDia : actual.idTipoDia,
            idTurno: forzado ? '' : (nombreTipo === 'TRABAJO' ? (actual.idTurno || '') : ''),
            idFuncion: forzado ? '' : (nombreTipo === 'TRABAJO' ? (actual.idFuncion || '') : ''),
            observaciones: forzado ? forzado.nota : ''
          });
        } else if (veredicto !== null) {
          omitidas.push({ persona: p.nombre, fecha: fecha, motivo: veredicto });
        }

        // El ciclo avanza siempre, se haya podido escribir o no: si se detuviera
        // en las ausencias, la rotación se desfasaría al volver la persona.
        paso++;
        fecha = Utilidades_.sumarDias(fecha, 1);
      }
    });

    return this._guardar(ctx, cfg.idArea, celdas, omitidas, 'PROGRAMAR_PATRON',
      'ciclo de ' + cfg.patron.length + ' día(s), ' + personas.length + ' persona(s)');
  },

  /**
   * Copia la programación de un mes a otro, día por número de día.
   * Las ausencias y feriados del mes destino mandan sobre lo copiado: si alguien
   * está de vacaciones en el mes nuevo, no se le traslada el turno del anterior.
   */
  copiarMes: function (ctx, cfg) {
    Auth_.exigirEscritura(ctx, 'CALENDARIO_PERSONAL');

    var diasOrigen = Utilidades_.diasDelMes(Number(cfg.anioOrigen), Number(cfg.mesOrigen));
    var diasDestino = Utilidades_.diasDelMes(Number(cfg.anioDestino), Number(cfg.mesDestino));
    if (diasOrigen[0] === diasDestino[0]) { throw new Error('El mes de origen y el de destino son el mismo.'); }

    var origen = {};
    Db_.leer('CALENDARIO_PERSONAL').forEach(function (r) {
      if (r.IDAREA !== cfg.idArea) { return; }
      if (String(r.ESTADO_PROGRAMACION).toUpperCase() === 'ANULADO') { return; }
      if (r.FECHA_CALENDARIO < diasOrigen[0] || r.FECHA_CALENDARIO > diasOrigen[diasOrigen.length - 1]) { return; }
      origen[r.IDPERSONAL + '|' + Number(r.FECHA_CALENDARIO.substring(8, 10))] = r;
    });
    if (!Object.keys(origen).length) {
      throw new Error('El mes de origen no tiene programación que copiar.');
    }

    var desdeD = diasDestino[0], hastaD = diasDestino[diasDestino.length - 1];
    var datos = this._preparar(cfg.idArea, desdeD, hastaD);
    var personas = this._filtrarPersonal(datos.personal, cfg.idsPersonal);

    var celdas = [], omitidas = [];
    var self = this;

    personas.forEach(function (p) {
      diasDestino.forEach(function (fecha) {
        var numero = Number(fecha.substring(8, 10));
        var molde = origen[p.IDPERSONAL + '|' + numero];
        if (!molde) { return; }

        var nombreTipo = datos.tipos[molde.IDTIPO_DIA] || '';
        var veredicto = self._evaluarCelda(datos, cfg, p, fecha, nombreTipo);
        if (veredicto === null) { return; }

        if (veredicto !== 'OK') {
          var forzado = self._resolverTipo(datos, cfg, p, fecha);
          if (forzado && veredicto !== 'ya estaba programado') {
            celdas.push({ idPersonal: p.IDPERSONAL, fecha: fecha, id: '',
                          idTipoDia: forzado.idTipoDia, idTurno: '', idFuncion: '',
                          observaciones: forzado.nota });
          } else {
            omitidas.push({ persona: p.nombre, fecha: fecha, motivo: veredicto });
          }
          return;
        }

        var forzadoOk = self._resolverTipo(datos, cfg, p, fecha);
        celdas.push({
          idPersonal: p.IDPERSONAL, fecha: fecha,
          id: (datos.ocupado[p.IDPERSONAL + '|' + fecha] || {}).IDCALENDARIO_PERSONAL || '',
          idTipoDia: forzadoOk ? forzadoOk.idTipoDia : molde.IDTIPO_DIA,
          idTurno: forzadoOk ? '' : (molde.IDTURNO || ''),
          idFuncion: forzadoOk ? '' : (molde.IDFUNCION || ''),
          observaciones: forzadoOk ? forzadoOk.nota : 'Copiado de ' + molde.FECHA_CALENDARIO
        });
      });
    });

    return this._guardar(ctx, cfg.idArea, celdas, omitidas, 'COPIAR_MES',
      cfg.mesOrigen + '/' + cfg.anioOrigen + ' → ' + cfg.mesDestino + '/' + cfg.anioDestino);
  },

  /** Anula la programación de un periodo. No borra: deja traza en la auditoría. */
  limpiarRango: function (ctx, cfg) {
    Permisos_.exigirTabla(ctx, 'CALENDARIO_PERSONAL', 'ANULAR');

    var desde = Utilidades_.aISO(cfg.desde);
    var hasta = Utilidades_.aISO(cfg.hasta);
    if (hasta < desde) { throw new Error('La fecha fin no puede ser anterior al inicio.'); }

    var seleccion = {};
    (cfg.idsPersonal || []).forEach(function (id) { seleccion[id] = true; });
    var todos = !cfg.idsPersonal || !cfg.idsPersonal.length;

    var n = 0, fallos = [];
    Db_.leer('CALENDARIO_PERSONAL').forEach(function (r) {
      if (r.IDAREA !== cfg.idArea) { return; }
      if (r.FECHA_CALENDARIO < desde || r.FECHA_CALENDARIO > hasta) { return; }
      if (String(r.ESTADO_PROGRAMACION).toUpperCase() === 'ANULADO') { return; }
      if (!todos && !seleccion[r.IDPERSONAL]) { return; }
      if (cfg.soloBorrador && String(r.ESTADO_PROGRAMACION).toUpperCase() !== 'BORRADOR') { return; }
      try {
        Db_.actualizar('CALENDARIO_PERSONAL', r.IDCALENDARIO_PERSONAL,
          { ESTADO_PROGRAMACION: 'ANULADO' }, ctx);
        n++;
      } catch (e) {
        fallos.push({ fecha: r.FECHA_CALENDARIO, error: e.message });
      }
    });

    Auditoria_.registrar(ctx, 'LIMPIAR_RANGO', 'CALENDARIO_PERSONAL', cfg.idArea, '', '',
      desde + ' a ' + hasta, 'OK', 'Días anulados: ' + n);

    return { anulados: n, fallos: fallos };
  },

  /** Guarda el lote y arma el informe de la operación. */
  _guardar: function (ctx, idArea, celdas, omitidas, accion, detalle) {
    if (!celdas.length) {
      return { generadas: 0, guardadas: 0, omitidas: omitidas, fallos: [],
               mensaje: 'No había nada que programar con esos criterios.' };
    }

    var r = Calendario_.guardarLote(ctx, idArea, celdas);
    Auditoria_.registrar(ctx, accion, 'CALENDARIO_PERSONAL', idArea, '', '', detalle, 'OK',
      'Guardadas: ' + r.guardados + ' · omitidas: ' + omitidas.length + ' · rechazadas: ' + r.fallos.length);

    return {
      generadas: celdas.length,
      guardadas: r.guardados,
      omitidas: omitidas,
      fallos: r.fallos,
      mensaje: r.guardados + ' día(s) programados' +
               (omitidas.length ? ' · ' + omitidas.length + ' omitidos' : '') +
               (r.fallos.length ? ' · ' + r.fallos.length + ' rechazados por las reglas' : '')
    };
  },

  _filtrarPersonal: function (personal, ids) {
    if (!ids || !ids.length) { return personal; }
    var mapa = {};
    ids.forEach(function (id) { mapa[id] = true; });
    return personal.filter(function (p) { return mapa[p.IDPERSONAL]; });
  },

  /** Datos que necesita la pantalla de programación masiva. */
  opciones: function (ctx, idArea, anio, mes) {
    Auth_.exigirLectura(ctx, 'CALENDARIO_PERSONAL');
    var dias = Utilidades_.diasDelMes(Number(anio), Number(mes));
    var personal = Reglas_.personalDeArea(idArea, dias[0], dias[dias.length - 1]);

    var tiposSistema = TIPOS_DIA_SISTEMA_();
    return {
      personal: personal.map(function (p) {
        return { id: p.IDPERSONAL, nombre: p.nombre };
      }),
      turnos: Reglas_.turnosDeArea(idArea).map(function (t) {
        return { id: t.IDTURNO, nombre: t.NOMBRE_TURNO,
                 inicio: t.HORA_INICIO, fin: t.HORA_FIN,
                 cruza: String(t.CRUZA_MEDIANOCHE).toUpperCase() === 'SI' };
      }),
      tiposDia: Db_.leer('TIPO_DIA').filter(function (t) {
        return String(t.ESTADO_TIPO).toUpperCase() === 'ACTIVO';
      }).map(function (t) {
        var nombre = String(t.TIPO_DIA).toUpperCase();
        return { id: t.IDTIPO_DIA, nombre: nombre,
                 color: t.COLOR,
                 bloquea: !!(tiposSistema[nombre] && tiposSistema[nombre].bloquea) };
      }),
      funciones: Db_.leer('FUNCION').filter(function (f) {
        return String(f.ESTADO).toUpperCase() === 'ACTIVO';
      }).map(function (f) {
        return { id: f.IDFUNCION, nombre: f.FUNCION, abrev: f.ABREVIATURA };
      }),
      diasSemana: this.DIAS_SEMANA.slice(1).concat([this.DIAS_SEMANA[0]]),
      puedeEditar: Auth_.puedeEscribir(ctx, 'CALENDARIO_PERSONAL'),
      puedeAnular: Permisos_.puedeTabla(ctx, 'CALENDARIO_PERSONAL', 'ANULAR')
    };
  }
};
