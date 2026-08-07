/**
 * 06_Reglas.gs
 * Motor de disponibilidad. Antes de armar el calendario responde, por persona y fecha:
 * ¿está libre para programar, o hay vacaciones, cumpleaños, compensatorio o descanso médico?
 */

var PARAMETROS_ = {
  MAX_DIAS_CONSECUTIVOS: 6,       // advertencia si supera este corrido de días de trabajo
  ESTADOS_QUE_BLOQUEAN: ['APROBADO'],
  ESTADOS_QUE_ADVIERTEN: ['PENDIENTE']
};

var Reglas_ = {

  /**
   * Construye un índice de ausencias: { IDPERSONAL: { 'yyyy-MM-dd': {tipo, estado, origen, detalle} } }
   * Una sola lectura de cada tabla para todo el rango: evita cuellos de botella en meses completos.
   */
  mapaAusencias: function (desde, hasta) {
    var mapa = {};
    var poner = function (idp, fecha, info) {
      if (!fecha || fecha < desde || fecha > hasta) { return; }
      if (!mapa[idp]) { mapa[idp] = {}; }
      var previo = mapa[idp][fecha];
      // Un bloqueo firme gana sobre una advertencia.
      if (!previo || (previo.nivel === 'ADVERTENCIA' && info.nivel === 'BLOQUEO')) {
        mapa[idp][fecha] = info;
      }
    };
    var nivelDe = function (estado) {
      estado = String(estado || '').toUpperCase();
      if (PARAMETROS_.ESTADOS_QUE_BLOQUEAN.indexOf(estado) >= 0) { return 'BLOQUEO'; }
      if (PARAMETROS_.ESTADOS_QUE_ADVIERTEN.indexOf(estado) >= 0) { return 'ADVERTENCIA'; }
      return null;
    };

    Db_.leer('VACACIONES').forEach(function (v) {
      var nivel = nivelDe(v.ESTADO_VACACIONES);
      if (!nivel) { return; }
      var f = v.FECHA_INICIO;
      var fin = v.FECHA_FIN || Utilidades_.sumarDias(f, Number(v.DIAS || 1) - 1);
      var guarda = 0;
      while (f && f <= fin && guarda++ < 400) {
        poner(v.IDPERSONAL, f, {
          tipo: 'VACACIONES', nivel: nivel, estado: v.ESTADO_VACACIONES,
          id: v.IDVACACIONES, detalle: 'Vacaciones ' + v.FECHA_INICIO + ' a ' + fin
        });
        f = Utilidades_.sumarDias(f, 1);
      }
    });

    Db_.leer('DESCANSO_MEDICO').forEach(function (d) {
      var nivel = nivelDe(d.ESTADO_DESCANSO);
      if (!nivel) { return; }
      var f = d.FECHA_INICIO, guarda = 0;
      while (f && f <= d.FECHA_FIN && guarda++ < 400) {
        poner(d.IDPERSONAL, f, {
          tipo: 'DESCANSO_MEDICO', nivel: nivel, estado: d.ESTADO_DESCANSO,
          id: d.IDDESCANSO_MEDICO, detalle: 'Descanso médico: ' + (d.DESCRIPCION || '')
        });
        f = Utilidades_.sumarDias(f, 1);
      }
    });

    Db_.leer('COMPENSATORIO').forEach(function (c) {
      var nivel = nivelDe(c.ESTADO_COMPENSATORIO);
      if (!nivel || !c.FECHA_COMPENSATORIO) { return; }
      poner(c.IDPERSONAL, c.FECHA_COMPENSATORIO, {
        tipo: 'COMPENSATORIO', nivel: nivel, estado: c.ESTADO_COMPENSATORIO,
        id: c.IDCOMPENSATORIO, detalle: 'Compensatorio generado el ' + c.FECHA_GENERACION
      });
    });

    Db_.leer('CUMPLEANIOS').forEach(function (b) {
      var nivel = nivelDe(b.ESTADO_BENEFICIO);
      if (!nivel || !b.FECHA_BENEFICIO) { return; }
      poner(b.IDPERSONAL, b.FECHA_BENEFICIO, {
        tipo: 'CUMPLEANIOS', nivel: nivel, estado: b.ESTADO_BENEFICIO,
        id: b.IDCUMPLEANIOS, detalle: 'Día libre por cumpleaños ' + b.ANIO_BENEFICIO
      });
    });

    return mapa;
  },

  /** Personal vigente en un área durante el rango indicado. */
  personalDeArea: function (idArea, desde, hasta) {
    var personas = {};
    Db_.leer('PERSONAL').forEach(function (p) { personas[p.IDPERSONAL] = p; });

    var salida = [];
    Db_.leer('PERSONAL_AREA').forEach(function (pa) {
      if (pa.IDAREA !== idArea) { return; }
      if (String(pa.ESTADO).toUpperCase() !== 'ACTIVO') { return; }
      if (pa.FECHA_INICIO && pa.FECHA_INICIO > hasta) { return; }
      if (pa.FECHA_FIN && pa.FECHA_FIN < desde) { return; }
      var p = personas[pa.IDPERSONAL];
      if (!p || String(p.ESTADO_PERSONAL).toUpperCase() !== 'ACTIVO') { return; }
      salida.push({
        IDPERSONAL: p.IDPERSONAL,
        nombre: p.APELLIDOS + ', ' + p.NOMBRES,
        IDCARGO: p.IDCARGO,
        desde: pa.FECHA_INICIO, hasta: pa.FECHA_FIN
      });
    });

    salida.sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
    return salida;
  },

  turnosDeArea: function (idArea) {
    var turnos = {};
    Db_.leer('TURNO').forEach(function (t) { turnos[t.IDTURNO] = t; });
    var salida = [];
    Db_.leer('AREA_TURNO').forEach(function (at) {
      if (at.IDAREA !== idArea || String(at.ESTADO).toUpperCase() !== 'ACTIVO') { return; }
      var t = turnos[at.IDTURNO];
      if (t && String(t.ESTADO_TURNO).toUpperCase() === 'ACTIVO') { salida.push(t); }
    });
    return salida;
  },

  idTipoDia: function (nombre) {
    var t = Db_.buscarPor('TIPO_DIA', 'TIPO_DIA', nombre);
    return t ? t.IDTIPO_DIA : '';
  },

  /**
   * Validaciones cruzadas por tabla. Devuelve array de mensajes (vacío = todo bien).
   * Se invoca desde Db_.validar, así aplica igual venga de la web o de un script.
   */
  validacionesDeNegocio: function (tabla, d, idActual) {
    var e = [];
    var F = Utilidades_.aISO;

    if (tabla === 'VACACIONES') {
      var fin = d.FECHA_FIN || Utilidades_.sumarDias(F(d.FECHA_INICIO), Number(d.DIAS || 1) - 1);
      if (fin < F(d.FECHA_INICIO)) { e.push('La fecha fin no puede ser anterior al inicio.'); }
      e = e.concat(this._solapa('VACACIONES', 'IDVACACIONES', d.IDPERSONAL, F(d.FECHA_INICIO), fin,
        idActual, 'ESTADO_VACACIONES', 'otro periodo de vacaciones'));
      e = e.concat(this._cruzaDescansoMedico(d.IDPERSONAL, F(d.FECHA_INICIO), fin));
    }

    if (tabla === 'DESCANSO_MEDICO') {
      if (F(d.FECHA_FIN) < F(d.FECHA_INICIO)) { e.push('La fecha fin no puede ser anterior al inicio.'); }
      e = e.concat(this._solapa('DESCANSO_MEDICO', 'IDDESCANSO_MEDICO', d.IDPERSONAL,
        F(d.FECHA_INICIO), F(d.FECHA_FIN), idActual, 'ESTADO_DESCANSO', 'otro descanso médico'));
    }

    if (tabla === 'COMPENSATORIO') {
      if (d.FECHA_COMPENSATORIO && F(d.FECHA_COMPENSATORIO) < F(d.FECHA_GENERACION)) {
        e.push('El día compensatorio no puede ser anterior a la fecha que lo generó.');
      }
      if (String(d.ESTADO_COMPENSATORIO).toUpperCase() === 'APROBADO' && !d.FECHA_COMPENSATORIO) {
        e.push('Para aprobar un compensatorio debes indicar la fecha en que se tomará.');
      }
    }

    if (tabla === 'CUMPLEANIOS') {
      var repetido = Db_.leer('CUMPLEANIOS').some(function (r) {
        return r.IDCUMPLEANIOS !== idActual && r.IDPERSONAL === d.IDPERSONAL &&
               String(r.ANIO_BENEFICIO) === String(d.ANIO_BENEFICIO) &&
               String(r.ESTADO_BENEFICIO).toUpperCase() !== 'ANULADO';
      });
      if (repetido) { e.push('Esa persona ya tiene registrado el beneficio de cumpleaños en ese año.'); }
    }

    if (tabla === 'PERSONAL_AREA') {
      if (d.FECHA_FIN && F(d.FECHA_FIN) < F(d.FECHA_INICIO)) {
        e.push('La fecha fin no puede ser anterior al inicio.');
      }
      var choque = Db_.leer('PERSONAL_AREA').some(function (r) {
        if (r.IDPERSONAL_AREA === idActual || r.IDPERSONAL !== d.IDPERSONAL) { return false; }
        if (String(r.ESTADO).toUpperCase() !== 'ACTIVO') { return false; }
        var aIni = F(d.FECHA_INICIO), aFin = d.FECHA_FIN ? F(d.FECHA_FIN) : '9999-12-31';
        var bIni = r.FECHA_INICIO, bFin = r.FECHA_FIN || '9999-12-31';
        return aIni <= bFin && bIni <= aFin;
      });
      if (choque) { e.push('Esa persona ya tiene una asignación de área activa en el mismo periodo.'); }
    }

    if (tabla === 'AREA_TURNO') {
      var dup = Db_.leer('AREA_TURNO').some(function (r) {
        return r.IDAREA_TURNO !== idActual && r.IDAREA === d.IDAREA && r.IDTURNO === d.IDTURNO;
      });
      if (dup) { e.push('Ese turno ya está habilitado para el área.'); }
    }

    if (tabla === 'CALENDARIO_PERSONAL') {
      e = e.concat(this.validarProgramacion(d, idActual));
    }

    return e;
  },

  /** Reglas de una celda del calendario. */
  validarProgramacion: function (d, idActual) {
    var e = [];
    var fecha = Utilidades_.aISO(d.FECHA_CALENDARIO);

    var duplicado = Db_.leer('CALENDARIO_PERSONAL').some(function (r) {
      return r.IDCALENDARIO_PERSONAL !== idActual &&
             r.IDPERSONAL === d.IDPERSONAL &&
             r.FECHA_CALENDARIO === fecha &&
             String(r.ESTADO_PROGRAMACION).toUpperCase() !== 'ANULADO';
    });
    if (duplicado) { e.push('Esa persona ya tiene una programación vigente el ' + fecha + '.'); }

    var asignado = Db_.leer('PERSONAL_AREA').some(function (r) {
      return r.IDPERSONAL === d.IDPERSONAL && r.IDAREA === d.IDAREA &&
             String(r.ESTADO).toUpperCase() === 'ACTIVO' &&
             (!r.FECHA_INICIO || r.FECHA_INICIO <= fecha) &&
             (!r.FECHA_FIN || r.FECHA_FIN >= fecha);
    });
    if (!asignado) { e.push('La persona no está asignada a esa área en la fecha ' + fecha + '.'); }

    var tipo = Db_.buscarPorId('TIPO_DIA', d.IDTIPO_DIA);
    var nombreTipo = tipo ? String(tipo.TIPO_DIA).toUpperCase() : '';
    var defs = TIPOS_DIA_SISTEMA_();
    var bloqueante = defs[nombreTipo] ? defs[nombreTipo].bloquea : false;

    if (nombreTipo === 'TRABAJO' && !d.IDTURNO) {
      e.push('Un día de trabajo necesita turno asignado.');
    }
    if (d.IDTURNO) {
      var habilitado = Db_.leer('AREA_TURNO').some(function (r) {
        return r.IDAREA === d.IDAREA && r.IDTURNO === d.IDTURNO &&
               String(r.ESTADO).toUpperCase() === 'ACTIVO';
      });
      if (!habilitado) { e.push('Ese turno no está habilitado para el área seleccionada.'); }
    }

    // El bloqueo por ausencia solo aplica si se intenta programar trabajo.
    if (!bloqueante) {
      var mapa = this.mapaAusencias(fecha, fecha);
      var au = mapa[d.IDPERSONAL] && mapa[d.IDPERSONAL][fecha];
      if (au && au.nivel === 'BLOQUEO') {
        e.push('No se puede programar: la persona tiene ' + au.tipo.replace('_', ' ').toLowerCase() +
               ' el ' + fecha + ' (' + au.detalle + ').');
      }
    }

    return e;
  },

  /** Avisos que no impiden guardar, pero conviene revisar antes de publicar. */
  advertenciasDeMes: function (idArea, anio, mes) {
    var dias = Utilidades_.diasDelMes(anio, mes);
    var desde = dias[0], hasta = dias[dias.length - 1];
    var avisos = [];

    var porPersona = {};
    Db_.leer('CALENDARIO_PERSONAL').forEach(function (r) {
      if (r.IDAREA !== idArea) { return; }
      if (r.FECHA_CALENDARIO < desde || r.FECHA_CALENDARIO > hasta) { return; }
      if (String(r.ESTADO_PROGRAMACION).toUpperCase() === 'ANULADO') { return; }
      if (!porPersona[r.IDPERSONAL]) { porPersona[r.IDPERSONAL] = {}; }
      porPersona[r.IDPERSONAL][r.FECHA_CALENDARIO] = r;
    });

    var tipos = {};
    Db_.leer('TIPO_DIA').forEach(function (t) { tipos[t.IDTIPO_DIA] = String(t.TIPO_DIA).toUpperCase(); });

    var mapa = this.mapaAusencias(desde, hasta);
    var personal = this.personalDeArea(idArea, desde, hasta);

    personal.forEach(function (p) {
      var corrido = 0, sinProgramar = 0;
      dias.forEach(function (f) {
        var reg = porPersona[p.IDPERSONAL] && porPersona[p.IDPERSONAL][f];
        if (!reg) { sinProgramar++; corrido = 0; return; }
        if (tipos[reg.IDTIPO_DIA] === 'TRABAJO') {
          corrido++;
          if (corrido === PARAMETROS_.MAX_DIAS_CONSECUTIVOS + 1) {
            avisos.push({ idPersonal: p.IDPERSONAL, persona: p.nombre, fecha: f,
              texto: 'Supera ' + PARAMETROS_.MAX_DIAS_CONSECUTIVOS + ' días de trabajo seguidos.' });
          }
        } else { corrido = 0; }

        var au = mapa[p.IDPERSONAL] && mapa[p.IDPERSONAL][f];
        if (au && au.nivel === 'ADVERTENCIA' && tipos[reg.IDTIPO_DIA] === 'TRABAJO') {
          avisos.push({ idPersonal: p.IDPERSONAL, persona: p.nombre, fecha: f,
            texto: 'Tiene ' + au.tipo.toLowerCase() + ' en estado pendiente de aprobación.' });
        }
      });
      if (sinProgramar > 0) {
        avisos.push({ idPersonal: p.IDPERSONAL, persona: p.nombre, fecha: '',
          texto: sinProgramar + ' día(s) del mes sin programar.' });
      }
    });

    return avisos;
  },

  _solapa: function (tabla, pk, idPersonal, ini, fin, idActual, campoEstado, etiqueta) {
    var choque = Db_.leer(tabla).some(function (r) {
      if (r[pk] === idActual || r.IDPERSONAL !== idPersonal) { return false; }
      var est = String(r[campoEstado]).toUpperCase();
      if (est === 'RECHAZADO' || est === 'ANULADO') { return false; }
      var rFin = r.FECHA_FIN || r.FECHA_INICIO;
      return ini <= rFin && r.FECHA_INICIO <= fin;
    });
    return choque ? ['El periodo se cruza con ' + etiqueta + ' de la misma persona.'] : [];
  },

  _cruzaDescansoMedico: function (idPersonal, ini, fin) {
    var choque = Db_.leer('DESCANSO_MEDICO').some(function (r) {
      if (r.IDPERSONAL !== idPersonal) { return false; }
      if (String(r.ESTADO_DESCANSO).toUpperCase() !== 'APROBADO') { return false; }
      return ini <= r.FECHA_FIN && r.FECHA_INICIO <= fin;
    });
    return choque ? ['El periodo se cruza con un descanso médico aprobado.'] : [];
  }
};
