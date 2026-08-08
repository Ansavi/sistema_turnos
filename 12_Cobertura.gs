/**
 * 12_Cobertura.gs
 * Motor de cobertura por juzgado.
 *
 * Es la regla central del sistema: un juzgado no puede quedar por debajo de su
 * COBERTURA_MINIMA de personas del cargo crítico. Vale igual para vacaciones,
 * compensatorio, licencia y cumpleaños — una sola función en lugar de cuatro
 * validaciones parecidas que tarde o temprano se desincronizan.
 *
 * El descanso médico es la excepción: nadie elige enfermarse, así que por defecto
 * se acepta y solo se avisa. Se cambia con el parámetro
 * COBERTURA_BLOQUEA_DESCANSO_MEDICO.
 */

var Cobertura_ = {

  /** Tablas de ausencia que consumen cobertura, con sus campos. */
  FUENTES: [
    { tabla: 'VACACIONES',      pk: 'IDVACACIONES',      estado: 'ESTADO_VACACIONES',
      ini: 'FECHA_INICIO', fin: 'FECHA_FIN', etiqueta: 'vacaciones' },
    { tabla: 'DESCANSO_MEDICO', pk: 'IDDESCANSO_MEDICO', estado: 'ESTADO_DESCANSO',
      ini: 'FECHA_INICIO', fin: 'FECHA_FIN', etiqueta: 'descanso médico' },
    { tabla: 'LICENCIA',        pk: 'IDLICENCIA',        estado: 'ESTADO_LICENCIA',
      ini: 'FECHA_INICIO', fin: 'FECHA_FIN', etiqueta: 'licencia' },
    { tabla: 'COMPENSATORIO',   pk: 'IDCOMPENSATORIO',   estado: 'ESTADO_COMPENSATORIO',
      ini: 'FECHA_COMPENSATORIO', fin: 'FECHA_COMPENSATORIO', etiqueta: 'compensatorio' },
    { tabla: 'CUMPLEANIOS',     pk: 'IDCUMPLEANIOS',     estado: 'ESTADO_BENEFICIO',
      ini: 'FECHA_BENEFICIO', fin: 'FECHA_BENEFICIO', etiqueta: 'día de cumpleaños' }
  ],

  /** Estados de una ausencia que efectivamente ocupan el día. */
  _ocupa: function (tabla, estado) {
    var e = String(estado || '').toUpperCase();
    if (tabla === 'COMPENSATORIO') { return e === 'PROGRAMADO' || e === 'USADO'; }
    return e === 'APROBADO' || e === 'PENDIENTE';
  },

  /** Configuración de cobertura del juzgado. Sin cargo crítico, no hay control. */
  configuracion: function (idArea) {
    var area = Db_.buscarPorId('AREA', idArea);
    if (!area) { return null; }
    var minimo = Number(area.COBERTURA_MINIMA);
    if (isNaN(minimo)) { minimo = PARAM_NUM_('COBERTURA_MINIMA_DEFECTO'); }

    /**
     * Cobertura por función: si el juzgado tiene filas en COBERTURA_AREA, cada
     * función lleva su propio mínimo. Un día con dos secretarios de trámite y
     * ninguno de ejecución deja el juzgado descubierto aunque haya dos personas.
     * Sin filas, se cuenta el total y el comportamiento no cambia.
     */
    var funciones = Db_.leer('FUNCION');
    var nombreFuncion = {};
    funciones.forEach(function (f) { nombreFuncion[f.IDFUNCION] = f.FUNCION; });

    var porFuncion = [];
    Db_.leer('COBERTURA_AREA').forEach(function (c) {
      if (c.IDAREA !== idArea || String(c.ESTADO).toUpperCase() !== 'ACTIVO') { return; }
      var min = Number(c.MINIMO);
      if (isNaN(min) || min <= 0) { return; }
      porFuncion.push({
        idFuncion: c.IDFUNCION,
        nombre: nombreFuncion[c.IDFUNCION] || c.IDFUNCION,
        minimo: min
      });
    });

    return {
      idArea: idArea,
      nombre: area.AREA,
      minimo: minimo,
      porFuncion: porFuncion,
      idCargoCritico: area.IDCARGO_CRITICO || '',
      controla: !!area.IDCARGO_CRITICO && (minimo > 0 || porFuncion.length > 0)
    };
  },

  /** Función de una persona en un juzgado en una fecha: la del día o la habitual. */
  funcionDe: function (idPersonal, idArea, fecha, funcionDelDia) {
    if (funcionDelDia) { return funcionDelDia; }
    var habitual = '';
    Db_.leer('PERSONAL_AREA').forEach(function (pa) {
      if (habitual || pa.IDPERSONAL !== idPersonal || pa.IDAREA !== idArea) { return; }
      if (String(pa.ESTADO).toUpperCase() !== 'ACTIVO') { return; }
      if (pa.FECHA_INICIO && pa.FECHA_INICIO > fecha) { return; }
      if (pa.FECHA_FIN && pa.FECHA_FIN < fecha) { return; }
      habitual = pa.IDFUNCION || '';
    });
    return habitual;
  },

  /**
   * Personas del cargo crítico adscritas al juzgado durante el rango.
   * Incluye a los volantes con reemplazo vigente: por eso un reemplazo
   * hace desaparecer el conflicto sin que nadie tenga que saltarse la regla.
   */
  plantilla: function (idArea, desde, hasta) {
    var cfg = this.configuracion(idArea);
    if (!cfg || !cfg.controla) { return []; }

    var personas = {};
    Db_.leer('PERSONAL').forEach(function (p) { personas[p.IDPERSONAL] = p; });

    var salida = [];
    var agregar = function (idPersonal, origen, ini, fin, idFuncion) {
      var p = personas[idPersonal];
      if (!p) { return; }
      if (p.IDCARGO !== cfg.idCargoCritico) { return; }
      if (String(p.ESTADO_PERSONAL).toUpperCase() !== 'ACTIVO') { return; }
      if (p.FECHA_CESE && p.FECHA_CESE < desde) { return; }
      salida.push({
        idPersonal: idPersonal,
        nombre: p.APELLIDOS + ', ' + p.NOMBRES,
        idFuncion: idFuncion || '',
        origen: origen,
        desde: ini || '',
        hasta: fin || '',
        cese: p.FECHA_CESE || ''
      });
    };

    Db_.leer('PERSONAL_AREA').forEach(function (pa) {
      if (pa.IDAREA !== idArea) { return; }
      if (String(pa.ESTADO).toUpperCase() !== 'ACTIVO') { return; }
      if (pa.FECHA_INICIO && pa.FECHA_INICIO > hasta) { return; }
      if (pa.FECHA_FIN && pa.FECHA_FIN < desde) { return; }
      agregar(pa.IDPERSONAL, 'TITULAR', pa.FECHA_INICIO, pa.FECHA_FIN, pa.IDFUNCION);
    });

    Db_.leer('REEMPLAZO').forEach(function (r) {
      if (r.IDAREA !== idArea) { return; }
      if (String(r.ESTADO).toUpperCase() !== 'ACTIVO') { return; }
      if (r.FECHA_INICIO > hasta || r.FECHA_FIN < desde) { return; }
      // Sin función explícita, el volante cubre la de la persona a la que reemplaza:
      // es lo que se espera cuando alguien entra a sustituir a otro.
      var fnReemplazo = r.IDFUNCION;
      if (!fnReemplazo && r.IDPERSONAL_CUBIERTO) {
        fnReemplazo = Cobertura_.funcionDe(r.IDPERSONAL_CUBIERTO, idArea, desde, '');
      }
      agregar(r.IDPERSONAL_VOLANTE, 'REEMPLAZO', r.FECHA_INICIO, r.FECHA_FIN, fnReemplazo);
    });

    return salida;
  },

  /** Índice { IDPERSONAL: { fecha: {tabla, etiqueta, id} } } de días ya ocupados. */
  _ocupacion: function (desde, hasta, excluir) {
    excluir = excluir || {};
    var mapa = {};
    var poner = function (idp, fecha, info) {
      if (!fecha || fecha < desde || fecha > hasta) { return; }
      if (!mapa[idp]) { mapa[idp] = {}; }
      if (!mapa[idp][fecha]) { mapa[idp][fecha] = info; }
    };

    this.FUENTES.forEach(function (f) {
      Db_.leer(f.tabla).forEach(function (r) {
        if (excluir.tabla === f.tabla && excluir.id === r[f.pk]) { return; }
        if (!Cobertura_._ocupa(f.tabla, r[f.estado])) { return; }
        var ini = r[f.ini];
        var fin = r[f.fin] || ini;
        if (!ini) { return; }
        var d = ini, guarda = 0;
        while (d <= fin && guarda++ < 400) {
          poner(r.IDPERSONAL, d, { tabla: f.tabla, etiqueta: f.etiqueta, id: r[f.pk] });
          d = Utilidades_.sumarDias(d, 1);
        }
      });
    });

    return mapa;
  },

  /**
   * Recorre día a día el rango y devuelve los días en que el juzgado quedaría
   * por debajo del mínimo, indicando quién más está ausente cada día.
   * `simulada` permite preguntar "¿qué pasaría si registro esto?" sin guardarlo.
   */
  evaluar: function (idArea, desde, hasta, simulada, excluir) {
    var cfg = this.configuracion(idArea);
    if (!cfg || !cfg.controla) {
      return { controla: false, conflictos: [], minimo: 0, juzgado: cfg ? cfg.nombre : '' };
    }

    var plantilla = this.plantilla(idArea, desde, hasta);
    var ocupacion = this._ocupacion(desde, hasta, excluir);
    var conflictos = [];

    var dia = desde, guarda = 0;
    while (dia <= hasta && guarda++ < 400) {
      var disponibles = [];
      var ausentes = [];

      for (var i = 0; i < plantilla.length; i++) {
        var p = plantilla[i];
        if (p.desde && dia < p.desde) { continue; }
        if (p.hasta && dia > p.hasta) { continue; }
        if (p.cese && dia > p.cese) { continue; }

        var ocupado = ocupacion[p.idPersonal] && ocupacion[p.idPersonal][dia];
        var simuladoAqui = simulada &&
                           simulada.idPersonal === p.idPersonal &&
                           dia >= simulada.desde && dia <= simulada.hasta;

        if (simuladoAqui) {
          ausentes.push({ nombre: p.nombre, idFuncion: p.idFuncion,
                          motivo: simulada.etiqueta || 'la ausencia que registras' });
        } else if (ocupado) {
          ausentes.push({ nombre: p.nombre, idFuncion: p.idFuncion, motivo: ocupado.etiqueta });
        } else {
          disponibles.push(p);
        }
      }

      // Cobertura global del juzgado
      if (cfg.minimo > 0 && disponibles.length < cfg.minimo) {
        conflictos.push({
          fecha: dia,
          funcion: '',
          disponibles: disponibles.length,
          requeridos: cfg.minimo,
          ausentes: ausentes
        });
      }

      // Cobertura por función: se evalúa cada una por separado.
      cfg.porFuncion.forEach(function (req) {
        var conEsaFuncion = disponibles.filter(function (p) {
          return p.idFuncion === req.idFuncion;
        });
        if (conEsaFuncion.length >= req.minimo) { return; }
        conflictos.push({
          fecha: dia,
          funcion: req.nombre,
          disponibles: conEsaFuncion.length,
          requeridos: req.minimo,
          ausentes: ausentes.filter(function (a) {
            return !a.idFuncion || a.idFuncion === req.idFuncion;
          })
        });
      });

      dia = Utilidades_.sumarDias(dia, 1);
    }

    return {
      controla: true,
      juzgado: cfg.nombre,
      minimo: cfg.minimo,
      conflictos: conflictos,
      plantilla: plantilla.length
    };
  },

  /**
   * Comprueba si una ausencia puede registrarse. Devuelve mensajes de error.
   * El mensaje nombra los días exactos y con quién choca: un "hay conflicto"
   * genérico obliga a la persona a adivinar qué mover.
   */
  validarAusencia: function (tabla, datos, idActual) {
    var fuente = this.FUENTES.filter(function (f) { return f.tabla === tabla; })[0];
    if (!fuente) { return []; }
    if (!this._ocupa(tabla, datos[fuente.estado])) { return []; }

    var desde = Utilidades_.aISO(datos[fuente.ini]);
    var hasta = Utilidades_.aISO(datos[fuente.fin] || datos[fuente.ini]);
    if (!desde) { return []; }
    if (hasta < desde) { hasta = desde; }

    var idArea = this.areaDe(datos.IDPERSONAL, desde);
    if (!idArea) { return []; }

    var r = this.evaluar(idArea, desde, hasta,
      { idPersonal: datos.IDPERSONAL, desde: desde, hasta: hasta, etiqueta: fuente.etiqueta },
      { tabla: tabla, id: idActual });

    if (!r.controla || !r.conflictos.length) { return []; }

    var bloquea = (tabla !== 'DESCANSO_MEDICO') || PARAM_SI_('COBERTURA_BLOQUEA_DESCANSO_MEDICO');
    if (!bloquea) { return []; }

    return [this.mensaje(r)];
  },

  /** Redacta el conflicto en lenguaje operativo. */
  mensaje: function (r) {
    var c = r.conflictos;
    var fechas = c.map(function (x) { return x.fecha; });
    var quienes = {};
    c.forEach(function (x) {
      x.ausentes.forEach(function (a) { quienes[a.nombre + ' (' + a.motivo + ')'] = true; });
    });

    var lista = fechas.length <= 4
      ? fechas.join(', ')
      : fechas[0] + ' … ' + fechas[fechas.length - 1] + ' (' + fechas.length + ' días)';

    // Si el conflicto es de una función concreta, decirlo: no es lo mismo quedarse
    // sin secretarios que quedarse sin secretario de ejecución.
    var funciones = {};
    c.forEach(function (x) { if (x.funcion) { funciones[x.funcion] = true; } });
    var nombres = Object.keys(funciones);
    var falta = nombres.length
      ? 'sin secretario de ' + nombres.join(' ni de ').toLowerCase()
      : 'sin la cobertura mínima de ' + r.minimo;

    return 'El juzgado ' + r.juzgado + ' quedaría ' + falta +
           ' el ' + lista + '. Coinciden: ' + Object.keys(quienes).join('; ') +
           '. Registra un reemplazo o mueve las fechas.';
  },

  /** Juzgado al que pertenece la persona en una fecha. */
  areaDe: function (idPersonal, fecha) {
    var encontrado = '';
    Db_.leer('PERSONAL_AREA').forEach(function (pa) {
      if (encontrado || pa.IDPERSONAL !== idPersonal) { return; }
      if (String(pa.ESTADO).toUpperCase() !== 'ACTIVO') { return; }
      if (pa.FECHA_INICIO && pa.FECHA_INICIO > fecha) { return; }
      if (pa.FECHA_FIN && pa.FECHA_FIN < fecha) { return; }
      encontrado = pa.IDAREA;
    });
    return encontrado;
  },

  /** Regla 46: un volante no puede cubrir dos juzgados el mismo día. */
  validarReemplazo: function (datos, idActual) {
    var e = [];
    var desde = Utilidades_.aISO(datos.FECHA_INICIO);
    var hasta = Utilidades_.aISO(datos.FECHA_FIN);

    if (hasta < desde) { e.push('La fecha fin no puede ser anterior al inicio.'); return e; }
    if (datos.IDPERSONAL_VOLANTE === datos.IDPERSONAL_CUBIERTO && datos.IDPERSONAL_CUBIERTO) {
      e.push('Una persona no puede reemplazarse a sí misma.');
    }

    var choque = Db_.leer('REEMPLAZO').filter(function (r) {
      if (r.IDREEMPLAZO === idActual) { return false; }
      if (r.IDPERSONAL_VOLANTE !== datos.IDPERSONAL_VOLANTE) { return false; }
      if (String(r.ESTADO).toUpperCase() !== 'ACTIVO') { return false; }
      if (r.IDAREA === datos.IDAREA) { return false; }
      return desde <= r.FECHA_FIN && r.FECHA_INICIO <= hasta;
    })[0];

    if (choque) {
      var otra = Db_.buscarPorId('AREA', choque.IDAREA);
      e.push('Ese volante ya cubre ' + (otra ? otra.AREA : choque.IDAREA) +
             ' del ' + choque.FECHA_INICIO + ' al ' + choque.FECHA_FIN +
             '. Nadie puede cubrir dos juzgados a la vez.');
    }

    // El titular del juzgado no necesita reemplazarse a sí mismo.
    var yaTitular = Db_.leer('PERSONAL_AREA').some(function (pa) {
      return pa.IDPERSONAL === datos.IDPERSONAL_VOLANTE && pa.IDAREA === datos.IDAREA &&
             String(pa.ESTADO).toUpperCase() === 'ACTIVO' &&
             (!pa.FECHA_FIN || pa.FECHA_FIN >= desde);
    });
    if (yaTitular) {
      e.push('Esa persona ya está asignada a ese juzgado: no hace falta registrarla como reemplazo.');
    }

    return e;
  },

  /**
   * Estado de cobertura de un juzgado en un rango, para el panel.
   * Muestra los días en riesgo aunque no haya nada que guardar.
   */
  panel: function (idArea, desde, hasta) {
    var r = this.evaluar(idArea, desde, hasta, null, null);
    if (!r.controla) {
      return { controla: false, mensaje: 'Este juzgado no tiene configurado el control de cobertura.' };
    }
    var cfg = this.configuracion(idArea);
    return {
      controla: true,
      juzgado: r.juzgado,
      minimo: r.minimo,
      porFuncion: cfg ? cfg.porFuncion : [],
      plantilla: r.plantilla,
      diasEnRiesgo: r.conflictos.length,
      detalle: r.conflictos
    };
  }
};
