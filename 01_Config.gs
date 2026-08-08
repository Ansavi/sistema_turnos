/**
 * 01_Config.gs — versión 2.0
 * Configuración central del Sistema de Control de Turnos.
 *
 * Todo el esquema vive aquí: Setup, Db, Reglas, Cobertura, Api y el frontend leen
 * de este archivo. Cambiar una tabla es cambiar una sola definición.
 */

function CONFIG_() {
  return {
    APP: 'Sistema de Turnos',
    VERSION: '2.0.0',
    TZ: 'America/Lima',
    SPREADSHEET_ID: '',
    ADMIN_INICIAL: '',
    CACHE_SEG: 120,
    /**
     * CREDENCIAL - usuario y contraseña propios (pantalla de acceso).
     * GOOGLE     - la cuenta de Google con la que se abre el enlace.
     * MIXTO      - intenta Google; si no está registrado, pide credenciales.
     */
    MODO_IDENTIDAD: 'CREDENCIAL'
  };
}

function SEGURIDAD_() {
  return {
    ITERACIONES: 700,
    LARGO_MINIMO: 10,
    EXIGE_MAYUSCULA: true,
    EXIGE_MINUSCULA: true,
    EXIGE_NUMERO: true,
    EXIGE_SIMBOLO: false,
    HISTORIAL_CLAVES: 3,
    INTENTOS_MAXIMOS: 5,
    MINUTOS_BLOQUEO: 15,
    MINUTOS_SESION: 480,
    DIAS_VIGENCIA_CLAVE: 90,
    CLAVE_TEMPORAL_LARGO: 12
  };
}

/**
 * Parámetros de negocio con su valor por defecto.
 * Se siembran en la hoja PARAMETRO y desde ahí se editan sin tocar código.
 */
function PARAMETROS_DEFECTO_() {
  return [
    { clave: 'DIAS_VIGENCIA_COMPENSATORIO', valor: '30', tipo: 'NUMERO',
      desc: 'Días para usar un compensatorio antes de que venza' },
    { clave: 'DIAS_AVISO_VENCIMIENTO', valor: '7', tipo: 'NUMERO',
      desc: 'Con cuántos días de anticipación avisa el panel' },
    { clave: 'MAX_DIAS_TRABAJO_SEGUIDOS', valor: '6', tipo: 'NUMERO',
      desc: 'Días de trabajo corridos a partir de los cuales se advierte' },
    { clave: 'COBERTURA_BLOQUEA_DESCANSO_MEDICO', valor: 'NO', tipo: 'BOOLEANO',
      desc: 'SI = rechaza un descanso medico que deja el juzgado descubierto. NO = lo acepta y solo avisa' },
    { clave: 'COBERTURA_MINIMA_DEFECTO', valor: '1', tipo: 'NUMERO',
      desc: 'Cobertura que se asigna a un juzgado nuevo' },
    { clave: 'HORAS_TURNO_EXTRAORDINARIO', valor: '24', tipo: 'NUMERO',
      desc: 'Duración del turno de juzgado' }
  ];
}

/** Lee un parámetro de la hoja PARAMETRO, con respaldo en el valor por defecto. */
function PARAM_(clave) {
  var fila = null;
  try { fila = Db_.buscarPor('PARAMETRO', 'CLAVE', clave); } catch (ignore) {}
  if (fila && String(fila.ESTADO).toUpperCase() === 'ACTIVO') { return String(fila.VALOR); }
  var def = PARAMETROS_DEFECTO_().filter(function (p) { return p.clave === clave; })[0];
  return def ? def.valor : '';
}

function PARAM_NUM_(clave) { return Number(PARAM_(clave)) || 0; }
function PARAM_SI_(clave) { return String(PARAM_(clave)).toUpperCase() === 'SI'; }

/**
 * Niveles de acceso. Solo describen el rol: los permisos efectivos viven en la
 * tabla PERMISO. ADMIN siempre tiene acceso total y no se puede recortar.
 */
function NIVELES_() {
  return {
    ADMIN: { etiqueta: 'Administrador', orden: 1, total: true,
      descripcion: 'Acceso total a todos los módulos, incluida la matriz de permisos.' },
    SUPERVISOR: { etiqueta: 'Supervisor', orden: 2,
      descripcion: 'Aprueba incidencias y publica la programación.' },
    OPERADOR: { etiqueta: 'Operador', orden: 3,
      descripcion: 'Arma el calendario y registra incidencias, sin publicar.' },
    LECTOR: { etiqueta: 'Consulta', orden: 4,
      descripcion: 'Solo visualiza y genera reportes.' }
  };
}

function PERMISOS_INICIALES_() {
  return {
    SUPERVISOR: {
      CALENDARIO: ['VER', 'CREAR', 'EDITAR', 'ANULAR', 'PUBLICAR'],
      INCIDENCIAS: ['VER', 'CREAR', 'EDITAR', 'ANULAR'],
      COBERTURA: ['VER', 'CREAR', 'EDITAR', 'ANULAR'],
      PERSONAL: ['VER', 'EDITAR'],
      MAESTROS: ['VER'],
      REPORTES: ['VER'],
      SEGURIDAD: [], PERMISOS: [], AUDITORIA: ['VER']
    },
    OPERADOR: {
      CALENDARIO: ['VER', 'CREAR', 'EDITAR'],
      INCIDENCIAS: ['VER', 'CREAR', 'EDITAR'],
      COBERTURA: ['VER', 'CREAR'],
      PERSONAL: ['VER'], MAESTROS: ['VER'], REPORTES: ['VER'],
      SEGURIDAD: [], PERMISOS: [], AUDITORIA: []
    },
    LECTOR: {
      CALENDARIO: ['VER'], INCIDENCIAS: ['VER'], COBERTURA: ['VER'],
      PERSONAL: ['VER'], MAESTROS: ['VER'], REPORTES: ['VER'],
      SEGURIDAD: [], PERMISOS: [], AUDITORIA: []
    }
  };
}

function CATALOGOS_() {
  return {
    ESTADO_GENERAL: ['ACTIVO', 'INACTIVO'],
    ESTADO_PERSONAL: ['ACTIVO', 'SUSPENDIDO', 'CESADO'],
    ESTADO_SOLICITUD: ['PENDIENTE', 'APROBADO', 'RECHAZADO', 'ANULADO'],
    ESTADO_COMPENSATORIO: ['PENDIENTE', 'PROGRAMADO', 'USADO', 'ANULADO', 'VENCIDO'],
    ESTADO_PROGRAMACION: ['BORRADOR', 'PUBLICADO', 'ANULADO'],
    ESTADO_VIGENCIA: ['ACTIVO', 'ANULADO'],
    TIPO_TURNO: ['DIURNO', 'NOCTURNO', 'MIXTO', 'GUARDIA'],
    TIPO_ROL_TURNO: ['ORDINARIO', 'EXTRAORDINARIO'],
    AMBITO_FERIADO: ['NACIONAL', 'INSTITUCIONAL', 'AREA'],
    MOTIVO_REEMPLAZO: ['DESCANSO_MEDICO', 'VACACIONES', 'LICENCIA', 'COMPENSATORIO', 'OTRO'],
    DIA_SEMANA: ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'],
    NIVEL_ACCESO: ['ADMIN', 'SUPERVISOR', 'OPERADOR', 'LECTOR'],
    SI_NO: ['SI', 'NO'],
    TIPO_DATO: ['NUMERO', 'TEXTO', 'FECHA', 'BOOLEANO'],
    ESTADO_CREDENCIAL: ['ACTIVA', 'BLOQUEADA', 'INACTIVA'],
    ESTADO_SESION: ['ABIERTA', 'CERRADA', 'EXPIRADA'],
    MODULO: ['CALENDARIO', 'INCIDENCIAS', 'COBERTURA', 'PERSONAL', 'MAESTROS',
             'REPORTES', 'SEGURIDAD', 'PERMISOS', 'AUDITORIA']
  };
}

/**
 * Tipos de día del sistema, con la prioridad del requerimiento.
 * Menor número gana ante conflicto. El motor los busca por nombre: no renombrar.
 */
function TIPOS_DIA_SISTEMA_() {
  return {
    DESCANSO_MEDICO: { prioridad: 1, color: '#B3261E', bloquea: true },
    VACACIONES:      { prioridad: 2, color: '#0F8A6E', bloquea: true },
    LICENCIA:        { prioridad: 3, color: '#4A5568', bloquea: true },
    COMPENSATORIO:   { prioridad: 4, color: '#7A5AA8', bloquea: true },
    CUMPLEANIOS:     { prioridad: 5, color: '#C77A0A', bloquea: true },
    FERIADO:         { prioridad: 6, color: '#2D6A8E', bloquea: true },
    DESCANSO:        { prioridad: 7, color: '#6B7A8C', bloquea: false },
    TRABAJO:         { prioridad: 8, color: '#1F5F8B', bloquea: false },
    CAPACITACION:    { prioridad: 9, color: '#3D7A5A', bloquea: false }
  };
}

/** Módulos sobre los que se otorgan permisos. */
function MODULOS_() {
  return {
    CALENDARIO: { etiqueta: 'Calendario', orden: 1,
      tablas: ['CALENDARIO_PERSONAL'],
      acciones: ['VER', 'CREAR', 'EDITAR', 'ANULAR', 'PUBLICAR'],
      nota: 'PUBLICAR pasa la programación de borrador a oficial.' },
    INCIDENCIAS: { etiqueta: 'Incidencias', orden: 2,
      tablas: ['VACACIONES', 'DESCANSO_MEDICO', 'COMPENSATORIO', 'CUMPLEANIOS', 'LICENCIA'],
      acciones: ['VER', 'CREAR', 'EDITAR', 'ANULAR'],
      nota: 'Vacaciones, descanso médico, compensatorios, licencias y cumpleaños.' },
    COBERTURA: { etiqueta: 'Cobertura y turno de juzgado', orden: 3,
      tablas: ['REEMPLAZO', 'ROL_TURNO_AREA'],
      acciones: ['VER', 'CREAR', 'EDITAR', 'ANULAR'],
      nota: 'Secretarios volantes y qué juzgado está de turno cada fecha.' },
    PERSONAL: { etiqueta: 'Personal', orden: 4,
      tablas: ['PERSONAL', 'PERSONAL_AREA'],
      acciones: ['VER', 'CREAR', 'EDITAR', 'ANULAR'],
      nota: 'Legajo del personal y su asignación a juzgados.' },
    MAESTROS: { etiqueta: 'Maestros', orden: 5,
      tablas: ['CARGO', 'AREA', 'TURNO', 'AREA_TURNO', 'TIPO_DIA', 'FERIADO', 'TIPO_LICENCIA'],
      acciones: ['VER', 'CREAR', 'EDITAR', 'ANULAR'],
      nota: 'Catálogos base: cargos, juzgados, turnos, tipos de día y feriados.' },
    REPORTES: { etiqueta: 'Reportes', orden: 6,
      tablas: [],
      acciones: ['VER'],
      nota: 'Consulta y exportación. No modifica datos.' },
    SEGURIDAD: { etiqueta: 'Usuarios y accesos', orden: 7,
      tablas: ['USUARIO', 'CREDENCIAL', 'SESION', 'PARAMETRO'],
      acciones: ['VER', 'CREAR', 'EDITAR', 'ANULAR', 'ADMINISTRAR'],
      nota: 'ADMINISTRAR habilita restablecer contraseñas, desbloquear y cerrar sesiones.' },
    PERMISOS: { etiqueta: 'Permisos', orden: 8,
      tablas: ['PERMISO'],
      acciones: ['VER', 'EDITAR'],
      nota: 'Matriz de qué puede hacer cada nivel en cada módulo.' },
    AUDITORIA: { etiqueta: 'Auditoría', orden: 9,
      tablas: ['AUDITORIA'],
      acciones: ['VER'],
      nota: 'Traza de accesos y cambios. Nunca es editable.' }
  };
}

function MODULO_DE_(tabla) {
  var mods = MODULOS_();
  var salida = '';
  Object.keys(mods).forEach(function (m) {
    if (mods[m].tablas.indexOf(tabla) >= 0) { salida = m; }
  });
  return salida;
}

/** Tablas que NO llevan las cuatro columnas de auditoría de fila. */
function SIN_AUDITORIA_FILA_() {
  return ['CREDENCIAL', 'SESION', 'AUDITORIA', 'PARAMETRO', 'PERMISO'];
}

/**
 * Definición del esquema.
 * tipo: texto | textoLargo | numero | fecha | fechaHora | hora | lista | ref | correo
 */
function ESQUEMA_() {
  var C = CATALOGOS_();
  var e = {

    /* ---------------- MAESTROS ---------------- */

    CARGO: {
      hoja: 'CARGO', pk: 'IDCARGO', prefijo: 'CAR', etiqueta: 'Cargos',
      grupo: 'Maestros', muestra: ['CARGO'], estado: 'ESTADO_CARGO',
      campos: [
        { c: 'IDCARGO', t: 'texto', pk: true },
        { c: 'CARGO', t: 'texto', req: true, unico: true },
        { c: 'ESTADO_CARGO', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    AREA: {
      hoja: 'AREA', pk: 'IDAREA', prefijo: 'ARE', etiqueta: 'Juzgados y áreas',
      grupo: 'Maestros', muestra: ['AREA'], estado: 'ESTADO_AREA',
      campos: [
        { c: 'IDAREA', t: 'texto', pk: true },
        { c: 'AREA', t: 'texto', req: true, unico: true },
        { c: 'COBERTURA_MINIMA', t: 'numero', req: true, def: 1, min: 0, max: 50 },
        { c: 'IDCARGO_CRITICO', t: 'ref', ref: 'CARGO' },
        { c: 'ESTADO_AREA', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    PERSONAL: {
      hoja: 'PERSONAL', pk: 'IDPERSONAL', prefijo: 'PER', etiqueta: 'Personal',
      grupo: 'Personal', muestra: ['APELLIDOS', 'NOMBRES'], estado: 'ESTADO_PERSONAL',
      campos: [
        { c: 'IDPERSONAL', t: 'texto', pk: true },
        { c: 'IDCARGO', t: 'ref', ref: 'CARGO', req: true },
        { c: 'DNI', t: 'texto', req: true, unico: true, largoMax: 12 },
        { c: 'NOMBRES', t: 'texto', req: true },
        { c: 'APELLIDOS', t: 'texto', req: true },
        { c: 'TELEFONO', t: 'texto' },
        { c: 'CORREO', t: 'correo', req: true, unico: true },
        { c: 'FECHA_NAC', t: 'fecha', req: true },
        { c: 'FECHA_INGRESO', t: 'fecha', req: true },
        { c: 'FECHA_CESE', t: 'fecha' },
        { c: 'ESTADO_PERSONAL', t: 'lista', ops: C.ESTADO_PERSONAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    PERSONAL_AREA: {
      hoja: 'PERSONAL_AREA', pk: 'IDPERSONAL_AREA', prefijo: 'PAR',
      etiqueta: 'Asignación a juzgado', grupo: 'Personal',
      muestra: ['IDPERSONAL', 'IDAREA'], estado: 'ESTADO',
      campos: [
        { c: 'IDPERSONAL_AREA', t: 'texto', pk: true },
        { c: 'IDPERSONAL', t: 'ref', ref: 'PERSONAL', req: true },
        { c: 'IDAREA', t: 'ref', ref: 'AREA', req: true },
        { c: 'FECHA_INICIO', t: 'fecha', req: true },
        { c: 'FECHA_FIN', t: 'fecha' },
        { c: 'ESTADO', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    TURNO: {
      hoja: 'TURNO', pk: 'IDTURNO', prefijo: 'TUR', etiqueta: 'Turnos',
      grupo: 'Maestros', muestra: ['NOMBRE_TURNO'], estado: 'ESTADO_TURNO',
      campos: [
        { c: 'IDTURNO', t: 'texto', pk: true },
        { c: 'NOMBRE_TURNO', t: 'texto', req: true, unico: true },
        { c: 'DIA_INICIO', t: 'lista', ops: C.DIA_SEMANA },
        { c: 'HORA_INICIO', t: 'hora', req: true },
        { c: 'DIA_FIN', t: 'lista', ops: C.DIA_SEMANA },
        { c: 'HORA_FIN', t: 'hora', req: true },
        { c: 'CRUZA_MEDIANOCHE', t: 'lista', ops: C.SI_NO, def: 'NO', calculado: true },
        { c: 'DURACION_HORAS', t: 'numero', calculado: true },
        { c: 'TIPO_TURNO', t: 'lista', ops: C.TIPO_TURNO, req: true },
        { c: 'ESTADO_TURNO', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    AREA_TURNO: {
      hoja: 'AREA_TURNO', pk: 'IDAREA_TURNO', prefijo: 'ATU', etiqueta: 'Turnos por juzgado',
      grupo: 'Maestros', muestra: ['IDAREA', 'IDTURNO'], estado: 'ESTADO',
      campos: [
        { c: 'IDAREA_TURNO', t: 'texto', pk: true },
        { c: 'IDAREA', t: 'ref', ref: 'AREA', req: true },
        { c: 'IDTURNO', t: 'ref', ref: 'TURNO', req: true },
        { c: 'ESTADO', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    TIPO_DIA: {
      hoja: 'TIPO_DIA', pk: 'IDTIPO_DIA', prefijo: 'TDI', etiqueta: 'Tipos de día',
      grupo: 'Maestros', muestra: ['TIPO_DIA'], estado: 'ESTADO_TIPO',
      campos: [
        { c: 'IDTIPO_DIA', t: 'texto', pk: true },
        { c: 'TIPO_DIA', t: 'texto', req: true, unico: true },
        { c: 'PRIORIDAD', t: 'numero', req: true, def: 8, min: 1, max: 99 },
        { c: 'COLOR', t: 'texto', req: true, def: '#6B7A8C' },
        { c: 'BLOQUEA_TRABAJO', t: 'lista', ops: C.SI_NO, req: true, def: 'NO' },
        { c: 'ESTADO_TIPO', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    FERIADO: {
      hoja: 'FERIADO', pk: 'IDFERIADO', prefijo: 'FER', etiqueta: 'Feriados',
      grupo: 'Maestros', muestra: ['FECHA', 'DESCRIPCION'], estado: 'ESTADO',
      campos: [
        { c: 'IDFERIADO', t: 'texto', pk: true },
        { c: 'FECHA', t: 'fecha', req: true },
        { c: 'DESCRIPCION', t: 'texto', req: true },
        { c: 'AMBITO', t: 'lista', ops: C.AMBITO_FERIADO, req: true, def: 'NACIONAL' },
        { c: 'IDAREA', t: 'ref', ref: 'AREA' },
        { c: 'ES_LABORABLE', t: 'lista', ops: C.SI_NO, req: true, def: 'NO' },
        { c: 'ESTADO', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    TIPO_LICENCIA: {
      hoja: 'TIPO_LICENCIA', pk: 'IDTIPO_LICENCIA', prefijo: 'TLI',
      etiqueta: 'Tipos de licencia', grupo: 'Maestros',
      muestra: ['TIPO_LICENCIA'], estado: 'ESTADO',
      campos: [
        { c: 'IDTIPO_LICENCIA', t: 'texto', pk: true },
        { c: 'TIPO_LICENCIA', t: 'texto', req: true, unico: true },
        { c: 'ES_REMUNERADA', t: 'lista', ops: C.SI_NO, req: true, def: 'SI' },
        { c: 'REQUIERE_DOCUMENTO', t: 'lista', ops: C.SI_NO, req: true, def: 'NO' },
        { c: 'ESTADO', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    /* ---------------- PROGRAMACIÓN ---------------- */

    CALENDARIO_PERSONAL: {
      hoja: 'CALENDARIO_PERSONAL', pk: 'IDCALENDARIO_PERSONAL', prefijo: 'CAL',
      etiqueta: 'Calendario', grupo: 'Programación',
      muestra: ['IDPERSONAL', 'FECHA_CALENDARIO'], estado: 'ESTADO_PROGRAMACION',
      campos: [
        { c: 'IDCALENDARIO_PERSONAL', t: 'texto', pk: true },
        { c: 'IDPERSONAL', t: 'ref', ref: 'PERSONAL', req: true },
        { c: 'IDAREA', t: 'ref', ref: 'AREA', req: true },
        { c: 'IDTURNO', t: 'ref', ref: 'TURNO' },
        { c: 'IDTIPO_DIA', t: 'ref', ref: 'TIPO_DIA', req: true },
        { c: 'FECHA_CALENDARIO', t: 'fecha', req: true },
        { c: 'INICIO_PROGRAMADO', t: 'fechaHora', calculado: true },
        { c: 'FIN_PROGRAMADO', t: 'fechaHora', calculado: true },
        { c: 'ESTADO_PROGRAMACION', t: 'lista', ops: C.ESTADO_PROGRAMACION, req: true, def: 'BORRADOR' },
        { c: 'VERSION', t: 'numero', def: 1, calculado: true },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    ROL_TURNO_AREA: {
      hoja: 'ROL_TURNO_AREA', pk: 'IDROL_TURNO', prefijo: 'ROL',
      etiqueta: 'Turno de juzgado', grupo: 'Programación',
      muestra: ['IDAREA', 'FECHA_INICIO'], estado: 'ESTADO',
      campos: [
        { c: 'IDROL_TURNO', t: 'texto', pk: true },
        { c: 'IDAREA', t: 'ref', ref: 'AREA', req: true },
        { c: 'FECHA_INICIO', t: 'fecha', req: true },
        { c: 'FECHA_FIN', t: 'fecha', req: true },
        { c: 'TIPO', t: 'lista', ops: C.TIPO_ROL_TURNO, req: true, def: 'ORDINARIO' },
        { c: 'ESTADO', t: 'lista', ops: C.ESTADO_VIGENCIA, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    REEMPLAZO: {
      hoja: 'REEMPLAZO', pk: 'IDREEMPLAZO', prefijo: 'REE',
      etiqueta: 'Reemplazos', grupo: 'Programación',
      muestra: ['IDPERSONAL_VOLANTE', 'IDAREA'], estado: 'ESTADO',
      campos: [
        { c: 'IDREEMPLAZO', t: 'texto', pk: true },
        { c: 'IDPERSONAL_VOLANTE', t: 'ref', ref: 'PERSONAL', req: true },
        { c: 'IDAREA', t: 'ref', ref: 'AREA', req: true },
        { c: 'IDPERSONAL_CUBIERTO', t: 'ref', ref: 'PERSONAL' },
        { c: 'FECHA_INICIO', t: 'fecha', req: true },
        { c: 'FECHA_FIN', t: 'fecha', req: true },
        { c: 'MOTIVO', t: 'lista', ops: C.MOTIVO_REEMPLAZO, req: true, def: 'OTRO' },
        { c: 'ESTADO', t: 'lista', ops: C.ESTADO_VIGENCIA, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    /* ---------------- INCIDENCIAS ---------------- */

    VACACIONES: {
      hoja: 'VACACIONES', pk: 'IDVACACIONES', prefijo: 'VAC', etiqueta: 'Vacaciones',
      grupo: 'Incidencias', muestra: ['IDPERSONAL', 'FECHA_INICIO'], estado: 'ESTADO_VACACIONES',
      campos: [
        { c: 'IDVACACIONES', t: 'texto', pk: true },
        { c: 'IDPERSONAL', t: 'ref', ref: 'PERSONAL', req: true },
        { c: 'FECHA_INICIO', t: 'fecha', req: true },
        { c: 'FECHA_FIN', t: 'fecha' },
        { c: 'DIAS', t: 'numero' },
        { c: 'ESTADO_VACACIONES', t: 'lista', ops: C.ESTADO_SOLICITUD, req: true, def: 'PENDIENTE' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    DESCANSO_MEDICO: {
      hoja: 'DESCANSO_MEDICO', pk: 'IDDESCANSO_MEDICO', prefijo: 'DME',
      etiqueta: 'Descanso médico', grupo: 'Incidencias',
      muestra: ['IDPERSONAL', 'FECHA_INICIO'], estado: 'ESTADO_DESCANSO',
      campos: [
        { c: 'IDDESCANSO_MEDICO', t: 'texto', pk: true },
        { c: 'IDPERSONAL', t: 'ref', ref: 'PERSONAL', req: true },
        { c: 'DESCRIPCION', t: 'texto', req: true },
        { c: 'FECHA_INICIO', t: 'fecha', req: true },
        { c: 'FECHA_FIN', t: 'fecha', req: true },
        { c: 'ESTADO_DESCANSO', t: 'lista', ops: C.ESTADO_SOLICITUD, req: true, def: 'APROBADO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    COMPENSATORIO: {
      hoja: 'COMPENSATORIO', pk: 'IDCOMPENSATORIO', prefijo: 'COM',
      etiqueta: 'Compensatorios', grupo: 'Incidencias',
      muestra: ['IDPERSONAL', 'FECHA_COMPENSATORIO'], estado: 'ESTADO_COMPENSATORIO',
      campos: [
        { c: 'IDCOMPENSATORIO', t: 'texto', pk: true },
        { c: 'IDPERSONAL', t: 'ref', ref: 'PERSONAL', req: true },
        { c: 'FECHA_GENERACION', t: 'fecha', req: true },
        { c: 'IDROL_TURNO', t: 'ref', ref: 'ROL_TURNO_AREA' },
        { c: 'FECHA_COMPENSATORIO', t: 'fecha' },
        { c: 'FECHA_VENCIMIENTO', t: 'fecha', calculado: true },
        { c: 'IDCALENDARIO_USO', t: 'ref', ref: 'CALENDARIO_PERSONAL' },
        { c: 'ESTADO_COMPENSATORIO', t: 'lista', ops: C.ESTADO_COMPENSATORIO, req: true, def: 'PENDIENTE' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    LICENCIA: {
      hoja: 'LICENCIA', pk: 'IDLICENCIA', prefijo: 'LIC', etiqueta: 'Licencias',
      grupo: 'Incidencias', muestra: ['IDPERSONAL', 'FECHA_INICIO'], estado: 'ESTADO_LICENCIA',
      campos: [
        { c: 'IDLICENCIA', t: 'texto', pk: true },
        { c: 'IDPERSONAL', t: 'ref', ref: 'PERSONAL', req: true },
        { c: 'IDTIPO_LICENCIA', t: 'ref', ref: 'TIPO_LICENCIA', req: true },
        { c: 'FECHA_INICIO', t: 'fecha', req: true },
        { c: 'FECHA_FIN', t: 'fecha', req: true },
        { c: 'ES_REMUNERADA', t: 'lista', ops: C.SI_NO, req: true, def: 'SI' },
        { c: 'DOCUMENTO', t: 'texto' },
        { c: 'ESTADO_LICENCIA', t: 'lista', ops: C.ESTADO_SOLICITUD, req: true, def: 'PENDIENTE' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    CUMPLEANIOS: {
      hoja: 'CUMPLEANIOS', pk: 'IDCUMPLEANIOS', prefijo: 'CUM',
      etiqueta: 'Día de cumpleaños', grupo: 'Incidencias',
      muestra: ['IDPERSONAL', 'ANIO_BENEFICIO'], estado: 'ESTADO_BENEFICIO',
      campos: [
        { c: 'IDCUMPLEANIOS', t: 'texto', pk: true },
        { c: 'IDPERSONAL', t: 'ref', ref: 'PERSONAL', req: true },
        { c: 'ANIO_BENEFICIO', t: 'numero', req: true, min: 2000, max: 2100 },
        { c: 'FECHA_BENEFICIO', t: 'fecha' },
        { c: 'ESTADO_BENEFICIO', t: 'lista', ops: C.ESTADO_SOLICITUD, req: true, def: 'PENDIENTE' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    /* ---------------- SEGURIDAD Y CONFIGURACIÓN ---------------- */

    USUARIO: {
      hoja: 'USUARIO', pk: 'IDUSUARIO', prefijo: 'USU', etiqueta: 'Usuarios',
      grupo: 'Seguridad', muestra: ['IDPERSONAL', 'NIVEL_ACCESO'], estado: 'ESTADO_USUARIO',
      soloAdmin: true,
      campos: [
        { c: 'IDUSUARIO', t: 'texto', pk: true },
        { c: 'IDPERSONAL', t: 'ref', ref: 'PERSONAL', req: true, unico: true },
        { c: 'NIVEL_ACCESO', t: 'lista', ops: C.NIVEL_ACCESO, req: true, def: 'LECTOR' },
        { c: 'ESTADO_USUARIO', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    CREDENCIAL: {
      hoja: 'CREDENCIAL', pk: 'IDCREDENCIAL', prefijo: 'CRE', etiqueta: 'Credenciales',
      grupo: 'Seguridad', muestra: ['USUARIO_LOGIN'], estado: 'ESTADO_CREDENCIAL',
      oculta: true,
      campos: [
        { c: 'IDCREDENCIAL', t: 'texto', pk: true },
        { c: 'IDUSUARIO', t: 'ref', ref: 'USUARIO', req: true, unico: true },
        { c: 'USUARIO_LOGIN', t: 'texto', req: true, unico: true },
        { c: 'HASH', t: 'textoLargo' },
        { c: 'SALT', t: 'texto' },
        { c: 'ITERACIONES', t: 'numero' },
        { c: 'HISTORIAL', t: 'textoLargo' },
        { c: 'DEBE_CAMBIAR', t: 'lista', ops: C.SI_NO, def: 'SI' },
        { c: 'FECHA_CAMBIO', t: 'texto' },
        { c: 'INTENTOS_FALLIDOS', t: 'numero', def: 0 },
        { c: 'BLOQUEADO_HASTA', t: 'texto' },
        { c: 'ULTIMO_ACCESO', t: 'texto' },
        { c: 'ESTADO_CREDENCIAL', t: 'lista', ops: C.ESTADO_CREDENCIAL, req: true, def: 'ACTIVA' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    SESION: {
      hoja: 'SESION', pk: 'IDSESION', prefijo: 'SES', etiqueta: 'Sesiones',
      grupo: 'Seguridad', muestra: ['IDUSUARIO', 'FECHA_INICIO'], estado: 'ESTADO_SESION',
      oculta: true,
      campos: [
        { c: 'IDSESION', t: 'texto', pk: true },
        { c: 'IDUSUARIO', t: 'texto' },
        { c: 'TOKEN_HASH', t: 'textoLargo' },
        { c: 'FECHA_INICIO', t: 'texto' },
        { c: 'ULTIMA_ACTIVIDAD', t: 'texto' },
        { c: 'FECHA_EXPIRA', t: 'texto' },
        { c: 'FECHA_CIERRE', t: 'texto' },
        { c: 'ESTADO_SESION', t: 'lista', ops: C.ESTADO_SESION, req: true, def: 'ABIERTA' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    PERMISO: {
      hoja: 'PERMISO', pk: 'IDPERMISO', prefijo: 'PMS', etiqueta: 'Permisos',
      grupo: 'Seguridad', muestra: ['NIVEL_ACCESO', 'MODULO'], estado: 'ESTADO',
      campos: [
        { c: 'IDPERMISO', t: 'texto', pk: true },
        { c: 'NIVEL_ACCESO', t: 'lista', ops: C.NIVEL_ACCESO, req: true },
        { c: 'MODULO', t: 'lista', ops: C.MODULO, req: true },
        { c: 'VER', t: 'lista', ops: C.SI_NO, req: true, def: 'NO' },
        { c: 'CREAR', t: 'lista', ops: C.SI_NO, req: true, def: 'NO' },
        { c: 'EDITAR', t: 'lista', ops: C.SI_NO, req: true, def: 'NO' },
        { c: 'ANULAR', t: 'lista', ops: C.SI_NO, req: true, def: 'NO' },
        { c: 'PUBLICAR', t: 'lista', ops: C.SI_NO, req: true, def: 'NO' },
        { c: 'ADMINISTRAR', t: 'lista', ops: C.SI_NO, req: true, def: 'NO' },
        { c: 'ESTADO', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },

    PARAMETRO: {
      hoja: 'PARAMETRO', pk: 'IDPARAMETRO', prefijo: 'PAR', etiqueta: 'Parámetros',
      grupo: 'Seguridad', muestra: ['CLAVE'], estado: 'ESTADO', soloAdmin: true,
      campos: [
        { c: 'IDPARAMETRO', t: 'texto', pk: true },
        { c: 'CLAVE', t: 'texto', req: true, unico: true },
        { c: 'VALOR', t: 'texto', req: true },
        { c: 'TIPO_DATO', t: 'lista', ops: C.TIPO_DATO, req: true, def: 'TEXTO' },
        { c: 'DESCRIPCION', t: 'texto', req: true },
        { c: 'ESTADO', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' }
      ]
    },

    AUDITORIA: {
      hoja: 'AUDITORIA', pk: 'IDAUDITORIA', prefijo: 'AUD', etiqueta: 'Auditoría',
      grupo: 'Seguridad', muestra: ['FECHA_HORA', 'CORREO'], soloLectura: true, soloAdmin: true,
      campos: [
        { c: 'IDAUDITORIA', t: 'texto', pk: true },
        { c: 'FECHA_HORA', t: 'texto' },
        { c: 'CORREO', t: 'correo' },
        { c: 'IDUSUARIO', t: 'texto' },
        { c: 'NIVEL_ACCESO', t: 'texto' },
        { c: 'ORIGEN', t: 'texto' },
        { c: 'ACCION', t: 'texto' },
        { c: 'TABLA', t: 'texto' },
        { c: 'ID_REGISTRO', t: 'texto' },
        { c: 'CAMPO', t: 'texto' },
        { c: 'VALOR_ANTERIOR', t: 'textoLargo' },
        { c: 'VALOR_NUEVO', t: 'textoLargo' },
        { c: 'RESULTADO', t: 'texto' },
        { c: 'DETALLE', t: 'textoLargo' }
      ]
    }
  };

  /**
   * Las cuatro columnas de auditoría de fila se añaden aquí, en un solo sitio.
   * Declararlas tabla por tabla serían 72 líneas repetidas y una fuente segura de
   * olvidos cuando se agregue una tabla nueva.
   */
  var excluidas = SIN_AUDITORIA_FILA_();
  Object.keys(e).forEach(function (t) {
    if (excluidas.indexOf(t) >= 0) { return; }
    e[t].auditoriaFila = true;
    e[t].campos = e[t].campos.concat([
      { c: 'FECHA_REGISTRO', t: 'texto', calculado: true, auditoria: true },
      { c: 'USUARIO_REGISTRO', t: 'texto', calculado: true, auditoria: true },
      { c: 'FECHA_MODIFICACION', t: 'texto', calculado: true, auditoria: true },
      { c: 'USUARIO_MODIFICACION', t: 'texto', calculado: true, auditoria: true }
    ]);
  });

  return e;
}

/** Orden en que se crean las hojas. Respeta las dependencias entre tablas. */
function ORDEN_HOJAS_() {
  return ['CARGO', 'AREA', 'TURNO', 'AREA_TURNO', 'TIPO_DIA', 'FERIADO', 'TIPO_LICENCIA',
          'PERSONAL', 'PERSONAL_AREA', 'CALENDARIO_PERSONAL', 'ROL_TURNO_AREA', 'REEMPLAZO',
          'VACACIONES', 'DESCANSO_MEDICO', 'COMPENSATORIO', 'LICENCIA', 'CUMPLEANIOS',
          'USUARIO', 'CREDENCIAL', 'SESION', 'PERMISO', 'PARAMETRO', 'AUDITORIA'];
}

function SS_() {
  var id = CONFIG_().SPREADSHEET_ID;
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
