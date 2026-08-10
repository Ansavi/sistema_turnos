/**
 * 08_Api.gs
 * Punto de entrada del web app y API única.
 *
 * Toda llamada del frontend pasa por api(accion, datos, token). Solo dos acciones son
 * públicas (consultar el modo de acceso e iniciar sesión); el resto exige un token de
 * sesión válido. El control de permisos se hace aquí, en el servidor: ocultar botones
 * en la pantalla es comodidad, no seguridad.
 */

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.appName = CONFIG_().APP;
  return t.evaluate()
    .setTitle(CONFIG_().APP)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Inserta un archivo HTML del proyecto dentro de otro.
 * Acepta el nombre con o sin extensión y, si no lo encuentra, dice cuál falta
 * en vez de dejar un error genérico de Apps Script.
 */
function incluir(archivo) {
  var intentos = [archivo, archivo + '.html', String(archivo).replace(/\.html$/, '')];
  for (var i = 0; i < intentos.length; i++) {
    try {
      return HtmlService.createHtmlOutputFromFile(intentos[i]).getContent();
    } catch (err) { /* prueba la siguiente variante */ }
  }
  throw new Error('Falta el archivo HTML "' + archivo + '" en el proyecto. ' +
    'Créalo con + → HTML escribiendo solo "' + archivo + '" (sin .html) y pega ahí el contenido de ' +
    archivo + '.html. Respeta mayúsculas y minúsculas.');
}

/** Acciones que no requieren sesión iniciada. */
var PUBLICAS_ = ['modoAcceso', 'iniciarSesion'];

/** Respuesta uniforme: { ok, datos } o { ok:false, error, sinSesion? }. */
function api(accion, datos, token) {
  datos = datos || {};

  try {
    if (PUBLICAS_.indexOf(accion) >= 0) {
      var publica = PUBLICO_[accion];
      if (!publica) { throw new Error('Acción no reconocida.'); }
      return { ok: true, datos: publica(datos) };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }

  var ctx;
  try {
    ctx = obtenerContexto_(token);
  } catch (err) {
    var expirada = (err.message === 'SESION_EXPIRADA');
    return {
      ok: false,
      sinSesion: true,
      expirada: expirada,
      error: expirada ? 'Tu sesión caducó por inactividad. Vuelve a ingresar.'
                      : (err.message === 'SIN_SESION' ? 'Necesitas iniciar sesión.' : err.message)
    };
  }

  try {
    var manejador = ENRUTADOR_[accion];
    if (!manejador) { throw new Error('Acción no reconocida: ' + accion); }
    return { ok: true, datos: manejador(ctx, datos) };
  } catch (err) {
    /**
     * Un error sin mensaje deja a la persona sin nada que hacer y a quien da
     * soporte sin nada que buscar. Aquí se garantiza que siempre haya texto y un
     * código de incidente con el que localizar el detalle en el registro.
     */
    var incidente = 'INC-' + Utilities.getUuid().substring(0, 6).toUpperCase();
    var detalle = (err && err.message) ? err.message
                : (err && err.name) ? err.name
                : String(err || 'fallo sin descripción');

    console.error('[' + incidente + '] acción "' + accion + '" · usuario ' +
                  (ctx.correo || '?') + '\n' + detalle + '\n' +
                  ((err && err.stack) ? err.stack : 'sin traza'));

    Auditoria_.registrar(ctx, 'ERROR', accion, incidente, '', '', '', 'FALLO',
      detalle.substring(0, 300));

    return {
      ok: false,
      error: detalle,
      incidente: incidente,
      accion: accion
    };
  }
}

/** Resuelve la identidad según el modo configurado. */
function obtenerContexto_(token) {
  var modo = String(CONFIG_().MODO_IDENTIDAD || 'CREDENCIAL').toUpperCase();
  if (modo === 'GOOGLE') { return Auth_.contextoPorGoogle(); }
  if (modo === 'MIXTO') {
    try { return Auth_.contextoPorGoogle(); } catch (ignore) {}
  }
  return Auth_.contexto(token);
}

/* ------------------------------------------------------------------ */
/* Acciones públicas                                                   */
/* ------------------------------------------------------------------ */
var PUBLICO_ = {

  modoAcceso: function () {
    var modo = String(CONFIG_().MODO_IDENTIDAD || 'CREDENCIAL').toUpperCase();
    var s = SEGURIDAD_();
    return {
      app: CONFIG_().APP,
      modo: modo,
      politica: {
        largoMinimo: s.LARGO_MINIMO,
        exigeMayuscula: s.EXIGE_MAYUSCULA,
        exigeMinuscula: s.EXIGE_MINUSCULA,
        exigeNumero: s.EXIGE_NUMERO,
        exigeSimbolo: s.EXIGE_SIMBOLO,
        intentosMaximos: s.INTENTOS_MAXIMOS,
        minutosBloqueo: s.MINUTOS_BLOQUEO,
        minutosSesion: s.MINUTOS_SESION
      }
    };
  },

  iniciarSesion: function (d) {
    return Auth_.iniciarSesion(d.usuario, d.clave);
  }
};

/* ------------------------------------------------------------------ */
/* Acciones con sesión                                                 */
/* ------------------------------------------------------------------ */
var ENRUTADOR_ = {

  /** Datos iniciales: identidad, permisos efectivos, catálogos y esquema. */
  arranque: function (ctx) {
    Auditoria_.registrar(ctx, 'ACCESO', 'USUARIO', ctx.idUsuario, '', '', '', 'OK', 'Ingreso al panel');

    var esquema = ESQUEMA_();
    var tablas = {};
    Object.keys(esquema).forEach(function (k) {
      var d = esquema[k];
      if (d.oculta) { return; }
      if (!Permisos_.puedeTabla(ctx, k, 'VER')) { return; }
      tablas[k] = {
        clave: k, etiqueta: d.etiqueta, grupo: d.grupo, pk: d.pk, muestra: d.muestra,
        estado: d.estado || '', soloLectura: !!d.soloLectura,
        modulo: MODULO_DE_(k),
        puedeCrear: Permisos_.puedeTabla(ctx, k, 'CREAR'),
        editable: Permisos_.puedeTabla(ctx, k, 'EDITAR'),
        puedeAnular: Permisos_.puedeTabla(ctx, k, 'ANULAR'),
        campos: d.campos.map(function (f) {
          return { c: f.c, t: f.t, req: !!f.req, ops: f.ops || null, ref: f.ref || null,
                   pk: !!f.pk, calculado: !!f.calculado, auditoria: !!f.auditoria };
        })
      };
    });

    var mods = MODULOS_();
    var permisos = {};
    Object.keys(mods).forEach(function (m) {
      permisos[m] = {};
      mods[m].acciones.forEach(function (a) { permisos[m][a] = Permisos_.puede(ctx, m, a); });
    });

    var hoy = new Date();
    return {
      usuario: {
        nombre: ctx.nombre, correo: ctx.correo, nivel: ctx.nivel,
        etiquetaNivel: ctx.etiquetaNivel, idUsuario: ctx.idUsuario
      },
      permisos: permisos,
      modoIdentidad: String(CONFIG_().MODO_IDENTIDAD).toUpperCase(),
      app: CONFIG_().APP,
      tablas: tablas,
      areas: Db_.leer('AREA').filter(function (a) { return String(a.ESTADO_AREA).toUpperCase() === 'ACTIVO'; })
               .map(function (a) { return { id: a.IDAREA, nombre: a.AREA }; }),
      hoy: Utilidades_.hoyISO(),
      anio: hoy.getFullYear(),
      mes: hoy.getMonth() + 1
    };
  },

  /* ---------- Sesión y contraseña propia ---------- */

  cerrarSesion: function (ctx) {
    Auth_._cerrarSesionesDe(ctx.idUsuario, 'Cierre solicitado por el usuario');
    Auditoria_.registrar(ctx, 'SALIDA', 'SESION', ctx.idSesion || '', '', '', '', 'OK', '');
    return true;
  },

  cambiarClave: function (ctx, d) {
    return Auth_.cambiarClave(ctx, d.actual, d.nueva);
  },

  /* ---------- Datos ---------- */

  listar: function (ctx, d) {
    var def = ESQUEMA_()[d.tabla];
    if (!def || def.oculta) { throw new Error('Esa tabla no se consulta desde el panel.'); }
    Permisos_.exigirTabla(ctx, d.tabla, 'VER');
    var filas = (d.tabla === 'AUDITORIA')
      ? Auditoria_.consultar(d.filtros || {})
      : Db_.leer(d.tabla);
    return { tabla: d.tabla, filas: filas, etiquetas: etiquetasRef_(d.tabla) };
  },

  crear: function (ctx, d) {
    Permisos_.exigirTabla(ctx, d.tabla, 'CREAR');
    return Db_.insertar(d.tabla, d.datos, ctx);
  },

  actualizar: function (ctx, d) {
    Permisos_.exigirTabla(ctx, d.tabla, 'EDITAR');
    if (d.tabla === 'USUARIO') { protegerUltimoAdmin_(d.id, d.datos); }
    return Db_.actualizar(d.tabla, d.id, d.datos, ctx);
  },

  anular: function (ctx, d) {
    Permisos_.exigirTabla(ctx, d.tabla, 'ANULAR');
    if (d.tabla === 'USUARIO') { protegerUltimoAdmin_(d.id, { ESTADO_USUARIO: 'INACTIVO' }); }
    return Db_.anular(d.tabla, d.id, ctx);
  },

  /* ---------- Calendario ---------- */

  tablero: function (ctx, d) {
    return Calendario_.tablero(ctx, d.idArea, Number(d.anio), Number(d.mes));
  },

  guardarCeldas: function (ctx, d) {
    return Calendario_.guardarLote(ctx, d.idArea, d.celdas || []);
  },

  prellenar: function (ctx, d) {
    return Calendario_.prellenarMes(ctx, d.idArea, Number(d.anio), Number(d.mes), d.idTurno || '');
  },

  publicar: function (ctx, d) {
    return Calendario_.publicarMes(ctx, d.idArea, Number(d.anio), Number(d.mes));
  },

  /* ---------- Reportes ---------- */

  /** Catálogo de reportes que el usuario puede ver, y los datos de los filtros. */
  reportesDisponibles: function (ctx) {
    Permisos_.exigir(ctx, 'REPORTES', 'VER');
    return {
      reportes: Reportes_.disponibles(ctx),
      areas: Db_.leer('AREA').filter(function (a) {
        return String(a.ESTADO_AREA).toUpperCase() === 'ACTIVO';
      }).map(function (a) { return { id: a.IDAREA, nombre: a.AREA }; }),
      personal: Db_.leer('PERSONAL').map(function (p) {
        return { id: p.IDPERSONAL, nombre: p.APELLIDOS + ', ' + p.NOMBRES };
      }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre); }),
      turnos: Db_.leer('TURNO').map(function (t) {
        return { id: t.IDTURNO, nombre: t.NOMBRE_TURNO };
      }),
      tiposDia: Db_.leer('TIPO_DIA').map(function (t) {
        return { id: t.IDTIPO_DIA, nombre: t.TIPO_DIA };
      }),
      hoy: Utilidades_.hoyISO()
    };
  },

  generarReporte: function (ctx, d) {
    return Reportes_.generar(ctx, d.clave, d.filtros || {});
  },

  exportarReporte: function (ctx, d) {
    return Reportes_.csv(ctx, d.clave, d.filtros || {});
  },

  /** Dashboard: indicadores, alertas y resúmenes del día. */
  panel: function (ctx, d) {
    return Panel_.resumen(ctx, d || {});
  },

  /** Tablero de una semana: siete días desde la fecha indicada. */
  tableroSemana: function (ctx, d) {
    var desde = Utilidades_.aISO(d.desde);
    return Calendario_.tableroRango(ctx, d.idArea, desde, Utilidades_.sumarDias(desde, 6));
  },

  /** Parte del día: quién trabaja, quién descansa y quién está ausente. */
  vistaDia: function (ctx, d) {
    return Calendario_.vistaDia(ctx, d.idArea, d.fecha);
  },

  /** Sello del rango, para detectar que otra persona modificó la programación. */
  sello: function (ctx, d) {
    return Calendario_.sello(ctx, d.idArea, Utilidades_.aISO(d.desde), Utilidades_.aISO(d.hasta));
  },

  disponibilidad: function (ctx, d) {
    var mapa = Reglas_.mapaAusencias(d.desde, d.hasta);
    return mapa[d.idPersonal] || {};
  },

  /* ---------- Seguridad ---------- */

  permisos: function (ctx) {
    return Permisos_.paraPantalla(ctx);
  },

  guardarPermisos: function (ctx, d) {
    return Permisos_.guardar(ctx, d.nivel, d.matriz || {});
  },

  accesoUsuario: function (ctx, d) {
    return Auth_.estadoCredencial(ctx, d.idUsuario);
  },

  restablecerClave: function (ctx, d) {
    return Auth_.restablecerClave(ctx, d.idUsuario);
  },

  desbloquearUsuario: function (ctx, d) {
    return Auth_.desbloquear(ctx, d.idUsuario);
  },

  cambiarLogin: function (ctx, d) {
    return Auth_.cambiarLogin(ctx, d.idUsuario, d.usuarioLogin);
  },

  cerrarSesionesUsuario: function (ctx, d) {
    return Auth_.cerrarSesionesDe(ctx, d.idUsuario);
  },

  auditoria: function (ctx, d) {
    Permisos_.exigir(ctx, 'AUDITORIA', 'VER');
    return Auditoria_.consultar(d.filtros || {});
  },

  /* ---------- Cobertura ---------- */

  /** Estado de cobertura de un juzgado en un mes, para la pantalla de riesgo. */
  cobertura: function (ctx, d) {
    Permisos_.exigir(ctx, 'COBERTURA', 'VER');
    var dias = Utilidades_.diasDelMes(Number(d.anio), Number(d.mes));
    var desde = dias[0], hasta = dias[dias.length - 1];

    var panel = Cobertura_.panel(d.idArea, desde, hasta);
    var personas = {};
    Db_.leer('PERSONAL').forEach(function (p) {
      personas[p.IDPERSONAL] = p.APELLIDOS + ', ' + p.NOMBRES;
    });

    var reemplazos = Db_.leer('REEMPLAZO').filter(function (r) {
      return r.IDAREA === d.idArea &&
             String(r.ESTADO).toUpperCase() === 'ACTIVO' &&
             r.FECHA_INICIO <= hasta && r.FECHA_FIN >= desde;
    }).map(function (r) {
      return {
        id: r.IDREEMPLAZO,
        volante: personas[r.IDPERSONAL_VOLANTE] || r.IDPERSONAL_VOLANTE,
        cubre: r.IDPERSONAL_CUBIERTO ? (personas[r.IDPERSONAL_CUBIERTO] || '') : '',
        desde: r.FECHA_INICIO, hasta: r.FECHA_FIN, motivo: r.MOTIVO
      };
    });

    var turnosJuzgado = Db_.leer('ROL_TURNO_AREA').filter(function (r) {
      return r.IDAREA === d.idArea && String(r.ESTADO).toUpperCase() === 'ACTIVO' &&
             r.FECHA_INICIO <= hasta && r.FECHA_FIN >= desde;
    }).map(function (r) {
      return { id: r.IDROL_TURNO, desde: r.FECHA_INICIO, hasta: r.FECHA_FIN, tipo: r.TIPO };
    });

    return {
      idArea: d.idArea, anio: Number(d.anio), mes: Number(d.mes),
      panel: panel,
      reemplazos: reemplazos,
      turnosJuzgado: turnosJuzgado,
      puedeEditar: Permisos_.puede(ctx, 'COBERTURA', 'CREAR')
    };
  },

  /**
   * Simula una ausencia sin guardarla: responde si dejaría el juzgado descubierto.
   * Permite avisar mientras la persona llena el formulario, en vez de rechazarla
   * al final cuando ya escribió todo.
   */
  simularAusencia: function (ctx, d) {
    Permisos_.exigir(ctx, 'INCIDENCIAS', 'VER');
    var idArea = Cobertura_.areaDe(d.idPersonal, d.desde);
    if (!idArea) { return { controla: false, mensaje: 'La persona no está asignada a un juzgado en esa fecha.' }; }

    var r = Cobertura_.evaluar(idArea, d.desde, d.hasta,
      { idPersonal: d.idPersonal, desde: d.desde, hasta: d.hasta, etiqueta: d.etiqueta || 'esta ausencia' },
      d.excluir ? { tabla: d.tabla, id: d.excluir } : null);

    return {
      controla: r.controla,
      conflictos: r.conflictos,
      juzgado: r.juzgado,
      minimo: r.minimo,
      mensaje: (r.controla && r.conflictos.length) ? Cobertura_.mensaje(r) : ''
    };
  },

  /* ---------- Compensatorios ---------- */

  /** Compensatorios por vencer y vencidos, para el aviso del panel. */
  compensatoriosPorVencer: function (ctx) {
    Permisos_.exigir(ctx, 'INCIDENCIAS', 'VER');
    var hoy = Utilidades_.hoyISO();
    var limite = Utilidades_.sumarDias(hoy, PARAM_NUM_('DIAS_AVISO_VENCIMIENTO'));
    var personas = {};
    Db_.leer('PERSONAL').forEach(function (p) {
      personas[p.IDPERSONAL] = p.APELLIDOS + ', ' + p.NOMBRES;
    });

    return Db_.leer('COMPENSATORIO').filter(function (c) {
      var est = String(c.ESTADO_COMPENSATORIO).toUpperCase();
      if (est !== 'PENDIENTE' && est !== 'PROGRAMADO') { return false; }
      return c.FECHA_VENCIMIENTO && c.FECHA_VENCIMIENTO <= limite;
    }).map(function (c) {
      return {
        id: c.IDCOMPENSATORIO,
        persona: personas[c.IDPERSONAL] || c.IDPERSONAL,
        generado: c.FECHA_GENERACION,
        vence: c.FECHA_VENCIMIENTO,
        fecha: c.FECHA_COMPENSATORIO || '',
        estado: c.ESTADO_COMPENSATORIO,
        diasRestantes: Utilidades_.diasEntre(hoy, c.FECHA_VENCIMIENTO) - 1
      };
    }).sort(function (a, b) { return a.vence.localeCompare(b.vence); });
  },

  /** Programa el día elegido por la persona. Pasa a PROGRAMADO. */
  programarCompensatorio: function (ctx, d) {
    Permisos_.exigir(ctx, 'INCIDENCIAS', 'EDITAR');
    return Db_.actualizar('COMPENSATORIO', d.id, {
      FECHA_COMPENSATORIO: d.fecha, ESTADO_COMPENSATORIO: 'PROGRAMADO'
    }, ctx);
  },

  /** Devuelve el compensatorio a PENDIENTE conservando su vencimiento original. */
  liberarCompensatorio: function (ctx, d) {
    Permisos_.exigir(ctx, 'INCIDENCIAS', 'EDITAR');
    return Db_.actualizar('COMPENSATORIO', d.id, {
      FECHA_COMPENSATORIO: '', ESTADO_COMPENSATORIO: 'PENDIENTE', IDCALENDARIO_USO: ''
    }, ctx);
  },

  /* ---------- Programación masiva ---------- */

  opcionesProgramacion: function (ctx, d) {
    return Programacion_.opciones(ctx, d.idArea, d.anio, d.mes);
  },

  programarRango: function (ctx, d) {
    return Programacion_.porRango(ctx, d);
  },

  programarPatron: function (ctx, d) {
    return Programacion_.porPatron(ctx, d);
  },

  copiarMes: function (ctx, d) {
    return Programacion_.copiarMes(ctx, d);
  },

  limpiarRango: function (ctx, d) {
    return Programacion_.limpiarRango(ctx, d);
  }
};

/**
 * Impide dejar el sistema sin ningún administrador activo: es la falla que obliga
 * a entrar por la hoja de cálculo a repararlo a mano.
 */
function protegerUltimoAdmin_(idUsuario, datos) {
  var actual = Db_.buscarPorId('USUARIO', idUsuario);
  if (!actual || String(actual.NIVEL_ACCESO).toUpperCase() !== 'ADMIN') { return; }

  var bajaNivel = datos.NIVEL_ACCESO && String(datos.NIVEL_ACCESO).toUpperCase() !== 'ADMIN';
  var desactiva = datos.ESTADO_USUARIO && String(datos.ESTADO_USUARIO).toUpperCase() !== 'ACTIVO';
  if (!bajaNivel && !desactiva) { return; }

  var otros = Db_.leer('USUARIO').filter(function (u) {
    return u.IDUSUARIO !== idUsuario &&
           String(u.NIVEL_ACCESO).toUpperCase() === 'ADMIN' &&
           String(u.ESTADO_USUARIO).toUpperCase() === 'ACTIVO';
  });
  if (!otros.length) {
    throw new Error('Es el único administrador activo. Asigna el nivel Administrador a otra persona antes de cambiar este usuario.');
  }
}

/**
 * Textos legibles de las claves foráneas: en los formularios se elige "Pérez, Ana",
 * no "PER-0007". Los desplegables solo ofrecen registros activos.
 */
function etiquetasRef_(tabla) {
  var esquema = ESQUEMA_();
  var def = esquema[tabla];
  var out = {};
  def.campos.forEach(function (f) {
    if (f.t !== 'ref') { return; }
    var refDef = esquema[f.ref];
    out[f.c] = Db_.leer(f.ref).map(function (r) {
      var texto = refDef.muestra.map(function (m) { return r[m]; }).join(' ');
      return {
        id: r[refDef.pk],
        texto: texto || r[refDef.pk],
        estado: refDef.estado ? r[refDef.estado] : 'ACTIVO'
      };
    });
  });
  return out;
}
