/**
 * 17_Reportes.gs
 * Reportes con filtros y exportación.
 *
 * Cada reporte declara sus columnas, sus filtros y cómo se arma. Añadir uno nuevo
 * es añadir una entrada al catálogo: no hay que tocar la API ni la pantalla.
 *
 * La exportación es CSV generado aquí y descargado por el navegador. No usa Drive
 * ni servicios externos, así que no exige ampliar los permisos del proyecto.
 */

var Reportes_ = {

  /* ---------------- Catálogo ---------------- */

  catalogo: function () {
    return [
      { clave: 'PERSONAL', nombre: 'Personal', modulo: 'PERSONAL',
        descripcion: 'Legajo con cargo, juzgado actual y función habitual.',
        filtros: ['idArea', 'estado'] },
      { clave: 'PROGRAMACION', nombre: 'Programación', modulo: 'CALENDARIO',
        descripcion: 'Detalle día a día: persona, juzgado, turno, horario y función.',
        filtros: ['desde', 'hasta', 'idArea', 'idPersonal', 'idTurno', 'idTipoDia', 'estado'] },
      { clave: 'HORAS', nombre: 'Horas programadas', modulo: 'CALENDARIO',
        descripcion: 'Total de horas y días por persona en el periodo.',
        filtros: ['desde', 'hasta', 'idArea', 'idPersonal'] },
      { clave: 'POR_JUZGADO', nombre: 'Programación por juzgado', modulo: 'CALENDARIO',
        descripcion: 'Días trabajados, descansos y ausencias agrupados por juzgado.',
        filtros: ['desde', 'hasta', 'idArea'] },
      { clave: 'VACACIONES', nombre: 'Vacaciones', modulo: 'INCIDENCIAS',
        descripcion: 'Periodos con días calculados y estado.',
        filtros: ['desde', 'hasta', 'idPersonal', 'estado'] },
      { clave: 'DESCANSO_MEDICO', nombre: 'Descansos médicos', modulo: 'INCIDENCIAS',
        descripcion: 'Periodos, diagnóstico y días de reposo.',
        filtros: ['desde', 'hasta', 'idPersonal', 'estado'] },
      { clave: 'COMPENSATORIOS', nombre: 'Compensatorios', modulo: 'INCIDENCIAS',
        descripcion: 'Generación, vencimiento, día elegido y estado del ciclo.',
        filtros: ['desde', 'hasta', 'idPersonal', 'estado'] },
      { clave: 'LICENCIAS', nombre: 'Licencias', modulo: 'INCIDENCIAS',
        descripcion: 'Tipo, periodo, si es remunerada y documento de respaldo.',
        filtros: ['desde', 'hasta', 'idPersonal', 'estado'] },
      { clave: 'CUMPLEANIOS', nombre: 'Cumpleaños', modulo: 'INCIDENCIAS',
        descripcion: 'Fecha de nacimiento y beneficio por año.',
        filtros: ['idArea', 'estado'] },
      { clave: 'COBERTURA', nombre: 'Cobertura', modulo: 'COBERTURA',
        descripcion: 'Días en que un juzgado queda por debajo de su mínimo.',
        filtros: ['desde', 'hasta', 'idArea'] },
      { clave: 'AUDITORIA', nombre: 'Auditoría', modulo: 'AUDITORIA',
        descripcion: 'Traza de accesos y cambios con valor anterior y nuevo.',
        filtros: ['desde', 'hasta'] }
    ];
  },

  /** Reportes que el usuario puede ver, según su nivel. */
  disponibles: function (ctx) {
    return this.catalogo().filter(function (r) {
      return Permisos_.puede(ctx, r.modulo, 'VER');
    });
  },

  /* ---------------- Ejecución ---------------- */

  generar: function (ctx, clave, filtros) {
    var def = this.catalogo().filter(function (r) { return r.clave === clave; })[0];
    if (!def) { throw new Error('Reporte no reconocido: ' + clave + '.'); }
    Permisos_.exigir(ctx, def.modulo, 'VER');

    filtros = filtros || {};
    filtros.desde = filtros.desde ? Utilidades_.aISO(filtros.desde) : '';
    filtros.hasta = filtros.hasta ? Utilidades_.aISO(filtros.hasta) : '';
    if (filtros.desde && filtros.hasta && filtros.hasta < filtros.desde) {
      throw new Error('La fecha fin no puede ser anterior al inicio.');
    }

    var r = this['_' + clave.toLowerCase()](filtros);
    r.clave = clave;
    r.nombre = def.nombre;
    r.generado = Utilidades_.ahora();
    r.total = r.filas.length;

    Auditoria_.registrar(ctx, 'REPORTE', clave, '', '', '',
      this._describirFiltros(filtros), 'OK', 'Filas: ' + r.total);
    return r;
  },

  _describirFiltros: function (f) {
    var partes = [];
    if (f.desde) { partes.push('desde ' + f.desde); }
    if (f.hasta) { partes.push('hasta ' + f.hasta); }
    if (f.idArea) { partes.push('juzgado ' + f.idArea); }
    if (f.idPersonal) { partes.push('persona ' + f.idPersonal); }
    if (f.estado) { partes.push('estado ' + f.estado); }
    return partes.length ? partes.join(' · ') : 'sin filtros';
  },

  /* ---------------- Índices reutilizables ---------------- */

  _indices: function () {
    var x = { persona: {}, cargo: {}, area: {}, turno: {}, tipoDia: {}, funcion: {}, tipoLic: {} };
    Db_.leer('PERSONAL').forEach(function (p) { x.persona[p.IDPERSONAL] = p; });
    Db_.leer('CARGO').forEach(function (c) { x.cargo[c.IDCARGO] = c.CARGO; });
    Db_.leer('AREA').forEach(function (a) { x.area[a.IDAREA] = a.AREA; });
    Db_.leer('TURNO').forEach(function (t) { x.turno[t.IDTURNO] = t; });
    Db_.leer('TIPO_DIA').forEach(function (t) { x.tipoDia[t.IDTIPO_DIA] = String(t.TIPO_DIA).toUpperCase(); });
    Db_.leer('FUNCION').forEach(function (f) { x.funcion[f.IDFUNCION] = f.FUNCION; });
    Db_.leer('TIPO_LICENCIA').forEach(function (t) { x.tipoLic[t.IDTIPO_LICENCIA] = t.TIPO_LICENCIA; });
    return x;
  },

  _nombre: function (x, id) {
    var p = x.persona[id];
    return p ? p.APELLIDOS + ', ' + p.NOMBRES : id;
  },

  /** Juzgado al que pertenecía la persona en una fecha. */
  _areaEn: function (idPersonal, fecha) {
    return Cobertura_.areaDe(idPersonal, fecha || Utilidades_.hoyISO());
  },

  _enRango: function (fecha, f) {
    if (f.desde && fecha < f.desde) { return false; }
    if (f.hasta && fecha > f.hasta) { return false; }
    return true;
  },

  /** Cruce de periodo con el rango del filtro. */
  _cruzaRango: function (ini, fin, f) {
    if (f.desde && (fin || ini) < f.desde) { return false; }
    if (f.hasta && ini > f.hasta) { return false; }
    return true;
  },

  /* ---------------- Reportes ---------------- */

  _personal: function (f) {
    var x = this._indices();
    var hoy = Utilidades_.hoyISO();
    var funcionHabitual = {};
    Db_.leer('PERSONAL_AREA').forEach(function (pa) {
      if (String(pa.ESTADO).toUpperCase() !== 'ACTIVO') { return; }
      if (pa.FECHA_FIN && pa.FECHA_FIN < hoy) { return; }
      funcionHabitual[pa.IDPERSONAL] = { idArea: pa.IDAREA, idFuncion: pa.IDFUNCION };
    });

    var filas = [];
    Db_.leer('PERSONAL').forEach(function (p) {
      var asig = funcionHabitual[p.IDPERSONAL] || {};
      if (f.idArea && asig.idArea !== f.idArea) { return; }
      if (f.estado && String(p.ESTADO_PERSONAL).toUpperCase() !== f.estado.toUpperCase()) { return; }
      filas.push([
        p.IDPERSONAL, p.DNI, p.APELLIDOS, p.NOMBRES,
        x.cargo[p.IDCARGO] || '', x.area[asig.idArea] || '',
        x.funcion[asig.idFuncion] || '', p.CORREO, p.TELEFONO,
        p.FECHA_NAC, p.FECHA_INGRESO, p.FECHA_CESE || '', p.ESTADO_PERSONAL
      ]);
    });

    return {
      columnas: ['ID', 'DNI', 'Apellidos', 'Nombres', 'Cargo', 'Juzgado', 'Función',
                 'Correo', 'Teléfono', 'Nacimiento', 'Ingreso', 'Cese', 'Estado'],
      filas: filas,
      resumen: [{ etiqueta: 'Personas', valor: filas.length }]
    };
  },

  _programacion: function (f) {
    var x = this._indices();
    var filas = [], horas = 0, dias = 0;

    Db_.leer('CALENDARIO_PERSONAL').forEach(function (r) {
      if (!Reportes_._enRango(r.FECHA_CALENDARIO, f)) { return; }
      if (f.idArea && r.IDAREA !== f.idArea) { return; }
      if (f.idPersonal && r.IDPERSONAL !== f.idPersonal) { return; }
      if (f.idTurno && r.IDTURNO !== f.idTurno) { return; }
      if (f.idTipoDia && r.IDTIPO_DIA !== f.idTipoDia) { return; }
      if (f.estado && String(r.ESTADO_PROGRAMACION).toUpperCase() !== f.estado.toUpperCase()) { return; }

      var t = x.turno[r.IDTURNO];
      var tipo = x.tipoDia[r.IDTIPO_DIA] || '';
      if (tipo === 'TRABAJO' && t) { horas += Number(t.DURACION_HORAS) || 0; dias++; }

      filas.push([
        r.FECHA_CALENDARIO, Utilidades_.diaSemana(r.FECHA_CALENDARIO),
        Reportes_._nombre(x, r.IDPERSONAL), x.area[r.IDAREA] || '',
        tipo, t ? t.NOMBRE_TURNO : '',
        r.INICIO_PROGRAMADO ? r.INICIO_PROGRAMADO.substring(11, 16) : '',
        r.FIN_PROGRAMADO ? r.FIN_PROGRAMADO.substring(11, 16) : '',
        t ? (Number(t.DURACION_HORAS) || '') : '',
        x.funcion[r.IDFUNCION] || '', r.ESTADO_PROGRAMACION, r.OBSERVACIONES || ''
      ]);
    });

    filas.sort(function (a, b) {
      return a[0] === b[0] ? String(a[2]).localeCompare(String(b[2])) : a[0].localeCompare(b[0]);
    });

    return {
      columnas: ['Fecha', 'Día', 'Persona', 'Juzgado', 'Tipo de día', 'Turno',
                 'Entrada', 'Salida', 'Horas', 'Función', 'Estado', 'Observaciones'],
      filas: filas,
      resumen: [
        { etiqueta: 'Registros', valor: filas.length },
        { etiqueta: 'Días de trabajo', valor: dias },
        { etiqueta: 'Horas programadas', valor: Math.round(horas * 10) / 10 }
      ]
    };
  },

  _horas: function (f) {
    var x = this._indices();
    var acum = {};

    Db_.leer('CALENDARIO_PERSONAL').forEach(function (r) {
      if (!Reportes_._enRango(r.FECHA_CALENDARIO, f)) { return; }
      if (String(r.ESTADO_PROGRAMACION).toUpperCase() === 'ANULADO') { return; }
      if (f.idArea && r.IDAREA !== f.idArea) { return; }
      if (f.idPersonal && r.IDPERSONAL !== f.idPersonal) { return; }

      var tipo = x.tipoDia[r.IDTIPO_DIA] || '';
      var a = acum[r.IDPERSONAL];
      if (!a) {
        a = acum[r.IDPERSONAL] = { idArea: r.IDAREA, trabajo: 0, horas: 0,
                                   descanso: 0, ausencia: 0 };
      }
      if (tipo === 'TRABAJO') {
        a.trabajo++;
        var t = x.turno[r.IDTURNO];
        a.horas += t ? (Number(t.DURACION_HORAS) || 0) : 0;
      } else if (tipo === 'DESCANSO') { a.descanso++; }
      else { a.ausencia++; }
    });

    var filas = Object.keys(acum).map(function (id) {
      var a = acum[id];
      return [Reportes_._nombre(x, id), x.area[a.idArea] || '',
              a.trabajo, Math.round(a.horas * 10) / 10,
              a.trabajo ? Math.round(a.horas / a.trabajo * 10) / 10 : 0,
              a.descanso, a.ausencia];
    }).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });

    var totalHoras = filas.reduce(function (s, r) { return s + r[3]; }, 0);
    return {
      columnas: ['Persona', 'Juzgado', 'Días de trabajo', 'Horas', 'Promedio por día',
                 'Descansos', 'Ausencias'],
      filas: filas,
      resumen: [
        { etiqueta: 'Personas', valor: filas.length },
        { etiqueta: 'Horas totales', valor: Math.round(totalHoras * 10) / 10 }
      ]
    };
  },

  _por_juzgado: function (f) {
    var x = this._indices();
    var acum = {};

    Db_.leer('CALENDARIO_PERSONAL').forEach(function (r) {
      if (!Reportes_._enRango(r.FECHA_CALENDARIO, f)) { return; }
      if (String(r.ESTADO_PROGRAMACION).toUpperCase() === 'ANULADO') { return; }
      if (f.idArea && r.IDAREA !== f.idArea) { return; }

      var a = acum[r.IDAREA];
      if (!a) {
        a = acum[r.IDAREA] = { trabajo: 0, horas: 0, descanso: 0, ausencia: 0,
                               personas: {}, publicados: 0 };
      }
      a.personas[r.IDPERSONAL] = true;
      if (String(r.ESTADO_PROGRAMACION).toUpperCase() === 'PUBLICADO') { a.publicados++; }

      var tipo = x.tipoDia[r.IDTIPO_DIA] || '';
      if (tipo === 'TRABAJO') {
        a.trabajo++;
        var t = x.turno[r.IDTURNO];
        a.horas += t ? (Number(t.DURACION_HORAS) || 0) : 0;
      } else if (tipo === 'DESCANSO') { a.descanso++; }
      else { a.ausencia++; }
    });

    var filas = Object.keys(acum).map(function (id) {
      var a = acum[id];
      return [x.area[id] || id, Object.keys(a.personas).length,
              a.trabajo, Math.round(a.horas * 10) / 10, a.descanso, a.ausencia, a.publicados];
    }).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });

    return {
      columnas: ['Juzgado', 'Personas', 'Días de trabajo', 'Horas', 'Descansos',
                 'Ausencias', 'Días publicados'],
      filas: filas,
      resumen: [{ etiqueta: 'Juzgados', valor: filas.length }]
    };
  },

  _vacaciones: function (f) {
    var x = this._indices();
    var filas = [], dias = 0;
    Db_.leer('VACACIONES').forEach(function (v) {
      if (!Reportes_._cruzaRango(v.FECHA_INICIO, v.FECHA_FIN, f)) { return; }
      if (f.idPersonal && v.IDPERSONAL !== f.idPersonal) { return; }
      if (f.estado && String(v.ESTADO_VACACIONES).toUpperCase() !== f.estado.toUpperCase()) { return; }
      dias += Number(v.DIAS) || 0;
      filas.push([Reportes_._nombre(x, v.IDPERSONAL),
                  x.area[Reportes_._areaEn(v.IDPERSONAL, v.FECHA_INICIO)] || '',
                  v.FECHA_INICIO, v.FECHA_FIN, v.DIAS, v.ESTADO_VACACIONES, v.OBSERVACIONES || '']);
    });
    filas.sort(function (a, b) { return String(a[2]).localeCompare(String(b[2])); });
    return {
      columnas: ['Persona', 'Juzgado', 'Desde', 'Hasta', 'Días', 'Estado', 'Observaciones'],
      filas: filas,
      resumen: [{ etiqueta: 'Periodos', valor: filas.length },
                { etiqueta: 'Días totales', valor: dias }]
    };
  },

  _descanso_medico: function (f) {
    var x = this._indices();
    var filas = [], dias = 0;
    Db_.leer('DESCANSO_MEDICO').forEach(function (d) {
      if (!Reportes_._cruzaRango(d.FECHA_INICIO, d.FECHA_FIN, f)) { return; }
      if (f.idPersonal && d.IDPERSONAL !== f.idPersonal) { return; }
      if (f.estado && String(d.ESTADO_DESCANSO).toUpperCase() !== f.estado.toUpperCase()) { return; }
      var n = Utilidades_.diasEntre(d.FECHA_INICIO, d.FECHA_FIN);
      dias += n;
      filas.push([Reportes_._nombre(x, d.IDPERSONAL),
                  x.area[Reportes_._areaEn(d.IDPERSONAL, d.FECHA_INICIO)] || '',
                  d.DESCRIPCION, d.FECHA_INICIO, d.FECHA_FIN, n, d.ESTADO_DESCANSO]);
    });
    filas.sort(function (a, b) { return String(a[3]).localeCompare(String(b[3])); });
    return {
      columnas: ['Persona', 'Juzgado', 'Descripción', 'Desde', 'Hasta', 'Días', 'Estado'],
      filas: filas,
      resumen: [{ etiqueta: 'Descansos', valor: filas.length },
                { etiqueta: 'Días totales', valor: dias }]
    };
  },

  _compensatorios: function (f) {
    var x = this._indices();
    var hoy = Utilidades_.hoyISO();
    var filas = [], porEstado = {};
    Db_.leer('COMPENSATORIO').forEach(function (c) {
      var ref = c.FECHA_COMPENSATORIO || c.FECHA_GENERACION;
      if (!Reportes_._enRango(ref, f)) { return; }
      if (f.idPersonal && c.IDPERSONAL !== f.idPersonal) { return; }
      if (f.estado && String(c.ESTADO_COMPENSATORIO).toUpperCase() !== f.estado.toUpperCase()) { return; }

      var restan = c.FECHA_VENCIMIENTO ? Utilidades_.diasEntre(hoy, c.FECHA_VENCIMIENTO) - 1 : '';
      porEstado[c.ESTADO_COMPENSATORIO] = (porEstado[c.ESTADO_COMPENSATORIO] || 0) + 1;
      filas.push([Reportes_._nombre(x, c.IDPERSONAL),
                  x.area[Reportes_._areaEn(c.IDPERSONAL, c.FECHA_GENERACION)] || '',
                  c.FECHA_GENERACION, c.FECHA_VENCIMIENTO || '',
                  c.FECHA_COMPENSATORIO || '', restan, c.ESTADO_COMPENSATORIO]);
    });
    filas.sort(function (a, b) { return String(a[2]).localeCompare(String(b[2])); });
    return {
      columnas: ['Persona', 'Juzgado', 'Generado', 'Vence', 'Día elegido',
                 'Días restantes', 'Estado'],
      filas: filas,
      resumen: Object.keys(porEstado).map(function (e) {
        return { etiqueta: e, valor: porEstado[e] };
      })
    };
  },

  _licencias: function (f) {
    var x = this._indices();
    var filas = [], dias = 0;
    Db_.leer('LICENCIA').forEach(function (l) {
      if (!Reportes_._cruzaRango(l.FECHA_INICIO, l.FECHA_FIN, f)) { return; }
      if (f.idPersonal && l.IDPERSONAL !== f.idPersonal) { return; }
      if (f.estado && String(l.ESTADO_LICENCIA).toUpperCase() !== f.estado.toUpperCase()) { return; }
      var n = Utilidades_.diasEntre(l.FECHA_INICIO, l.FECHA_FIN);
      dias += n;
      filas.push([Reportes_._nombre(x, l.IDPERSONAL),
                  x.tipoLic[l.IDTIPO_LICENCIA] || '', l.FECHA_INICIO, l.FECHA_FIN, n,
                  l.ES_REMUNERADA, l.DOCUMENTO || '', l.ESTADO_LICENCIA]);
    });
    filas.sort(function (a, b) { return String(a[2]).localeCompare(String(b[2])); });
    return {
      columnas: ['Persona', 'Tipo', 'Desde', 'Hasta', 'Días', 'Remunerada', 'Documento', 'Estado'],
      filas: filas,
      resumen: [{ etiqueta: 'Licencias', valor: filas.length },
                { etiqueta: 'Días totales', valor: dias }]
    };
  },

  _cumpleanios: function (f) {
    var x = this._indices();
    var beneficios = {};
    Db_.leer('CUMPLEANIOS').forEach(function (c) {
      beneficios[c.IDPERSONAL + '|' + c.ANIO_BENEFICIO] = c;
    });
    var anio = new Date().getFullYear();
    var hoy = Utilidades_.hoyISO();

    var filas = [];
    Db_.leer('PERSONAL').forEach(function (p) {
      if (f.estado && String(p.ESTADO_PERSONAL).toUpperCase() !== f.estado.toUpperCase()) { return; }
      var idArea = Reportes_._areaEn(p.IDPERSONAL, hoy);
      if (f.idArea && idArea !== f.idArea) { return; }
      var b = beneficios[p.IDPERSONAL + '|' + anio];
      filas.push([Reportes_._nombre(x, p.IDPERSONAL), x.area[idArea] || '',
                  p.FECHA_NAC, String(p.FECHA_NAC).substring(5, 7),
                  b ? b.FECHA_BENEFICIO : '', b ? b.ESTADO_BENEFICIO : 'sin generar']);
    });
    filas.sort(function (a, b) {
      return String(a[2]).substring(5).localeCompare(String(b[2]).substring(5));
    });
    return {
      columnas: ['Persona', 'Juzgado', 'Nacimiento', 'Mes', 'Día de beneficio ' + anio, 'Estado'],
      filas: filas,
      resumen: [{ etiqueta: 'Personas', valor: filas.length }]
    };
  },

  _cobertura: function (f) {
    var desde = f.desde || Utilidades_.hoyISO();
    var hasta = f.hasta || Utilidades_.sumarDias(desde, 30);
    var filas = [];

    Db_.leer('AREA').forEach(function (a) {
      if (String(a.ESTADO_AREA).toUpperCase() !== 'ACTIVO') { return; }
      if (f.idArea && a.IDAREA !== f.idArea) { return; }
      var panel = Cobertura_.panel(a.IDAREA, desde, hasta);
      if (!panel.controla) { return; }
      panel.detalle.forEach(function (d) {
        filas.push([a.AREA, d.fecha, Utilidades_.diaSemana(d.fecha),
                    d.funcion || 'cualquiera', d.disponibles, d.requeridos,
                    d.ausentes.map(function (x) { return x.nombre + ' (' + x.motivo + ')'; }).join(' · ')]);
      });
    });
    filas.sort(function (a, b) { return String(a[1]).localeCompare(String(b[1])); });
    return {
      columnas: ['Juzgado', 'Fecha', 'Día', 'Función', 'Disponibles', 'Requeridos', 'Ausentes'],
      filas: filas,
      resumen: [{ etiqueta: 'Días descubiertos', valor: filas.length }]
    };
  },

  _auditoria: function (f) {
    var filas = Auditoria_.consultar({
      desde: f.desde, hasta: f.hasta, limite: 2000
    }).map(function (r) {
      return [r.FECHA_HORA, r.CORREO, r.NIVEL_ACCESO, r.ORIGEN, r.ACCION,
              r.TABLA, r.ID_REGISTRO, r.CAMPO, r.VALOR_ANTERIOR, r.VALOR_NUEVO, r.RESULTADO];
    });
    return {
      columnas: ['Fecha y hora', 'Usuario', 'Nivel', 'Origen', 'Acción', 'Tabla',
                 'Registro', 'Campo', 'Antes', 'Después', 'Resultado'],
      filas: filas,
      resumen: [{ etiqueta: 'Movimientos', valor: filas.length }]
    };
  },

  /* ---------------- Exportación ---------------- */

  /**
   * Convierte el reporte a CSV.
   *
   * Los valores que empiezan por =, +, - o @ se prefijan con un apóstrofo: sin eso,
   * al abrir el archivo en Excel o Sheets se ejecutarían como fórmula. Es la versión
   * de la inyección de código que sí aplica a este sistema, ya que aquí no hay SQL.
   */
  csv: function (ctx, clave, filtros) {
    var r = this.generar(ctx, clave, filtros);
    var escapar = function (v) {
      var s = (v === null || v === undefined) ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) { s = "'" + s; }
      if (/[";\n\r]/.test(s)) { s = '"' + s.replace(/"/g, '""') + '"'; }
      return s;
    };

    // Separador punto y coma: es lo que espera Excel en configuración regional española.
    var lineas = [r.columnas.map(escapar).join(';')];
    r.filas.forEach(function (fila) { lineas.push(fila.map(escapar).join(';')); });

    return {
      nombre: 'reporte_' + clave.toLowerCase() + '_' + Utilidades_.hoyISO() + '.csv',
      contenido: lineas.join('\r\n'),
      filas: r.total
    };
  }
};
