/**
 * 01_Config.gs
 * Configuración central del Sistema de Turnos.
 * Todo el esquema vive aquí: Setup, Db, Api y el frontend leen de este archivo.
 */

function CONFIG_() {
  return {
    APP: 'Sistema de Turnos',
    VERSION: '1.0.0',
    TZ: 'America/Lima',
    // Vacío = usa la hoja de cálculo contenedora del script.
    SPREADSHEET_ID: '',
    // Correo que queda como ADMIN al ejecutar instalar(). Vacío = dueño del archivo.
    ADMIN_INICIAL: '',
    // Duración de caché de catálogos en segundos.
    CACHE_SEG: 120,
    /**
     * Cómo se identifica la persona:
     *  CREDENCIAL - usuario y contraseña propios del sistema (pantalla de acceso).
     *  GOOGLE     - la cuenta de Google con la que abre el enlace.
     *  MIXTO      - intenta Google; si el correo no está registrado, pide credenciales.
     */
    MODO_IDENTIDAD: 'CREDENCIAL'
  };
}

/** Parámetros de la política de contraseñas y sesiones. */
function SEGURIDAD_() {
  return {
    ITERACIONES: 1200,            // vueltas de HMAC-SHA256 al derivar el hash
    LARGO_MINIMO: 10,
    EXIGE_MAYUSCULA: true,
    EXIGE_MINUSCULA: true,
    EXIGE_NUMERO: true,
    EXIGE_SIMBOLO: false,
    HISTORIAL_CLAVES: 3,          // no repetir las últimas N contraseñas
    INTENTOS_MAXIMOS: 5,
    MINUTOS_BLOQUEO: 15,
    MINUTOS_SESION: 480,          // caduca a las 8 horas de inactividad
    DIAS_VIGENCIA_CLAVE: 90,      // 0 = sin caducidad
    CLAVE_TEMPORAL_LARGO: 12
  };
}

/**
 * Módulos sobre los que se otorgan permisos.
 * Cada módulo agrupa las tablas que controla: así el administrador razona en
 * términos de negocio ("Ausencias") y no de hojas sueltas.
 */
function MODULOS_() {
  return {
    CALENDARIO: {
      etiqueta: 'Calendario', orden: 1,
      tablas: ['CALENDARIO_PERSONAL'],
      acciones: ['VER', 'CREAR', 'EDITAR', 'ANULAR', 'PUBLICAR'],
      nota: 'PUBLICAR pasa la programación de borrador a oficial.'
    },
    AUSENCIAS: {
      etiqueta: 'Ausencias', orden: 2,
      tablas: ['VACACIONES', 'DESCANSO_MEDICO', 'COMPENSATORIO', 'CUMPLEANIOS'],
      acciones: ['VER', 'CREAR', 'EDITAR', 'ANULAR'],
      nota: 'Vacaciones, descanso médico, compensatorios y día de cumpleaños.'
    },
    PERSONAL: {
      etiqueta: 'Personal', orden: 3,
      tablas: ['PERSONAL', 'PERSONAL_AREA'],
      acciones: ['VER', 'CREAR', 'EDITAR', 'ANULAR'],
      nota: 'Legajo del personal y su asignación a áreas.'
    },
    MAESTROS: {
      etiqueta: 'Maestros', orden: 4,
      tablas: ['CARGO', 'AREA', 'TURNO', 'AREA_TURNO', 'TIPO_DIA'],
      acciones: ['VER', 'CREAR', 'EDITAR', 'ANULAR'],
      nota: 'Catálogos base: cargos, áreas, turnos y tipos de día.'
    },
    SEGURIDAD: {
      etiqueta: 'Usuarios y accesos', orden: 5,
      tablas: ['USUARIO', 'CREDENCIAL', 'SESION'],
      acciones: ['VER', 'CREAR', 'EDITAR', 'ANULAR', 'ADMINISTRAR'],
      nota: 'ADMINISTRAR habilita restablecer contraseñas, desbloquear y cerrar sesiones.'
    },
    PERMISOS: {
      etiqueta: 'Permisos', orden: 6,
      tablas: ['PERMISO'],
      acciones: ['VER', 'EDITAR'],
      nota: 'Matriz de qué puede hacer cada nivel en cada módulo.'
    },
    AUDITORIA: {
      etiqueta: 'Auditoría', orden: 7,
      tablas: ['AUDITORIA'],
      acciones: ['VER'],
      nota: 'Traza de accesos y cambios. Nunca es editable.'
    }
  };
}

/** Devuelve el módulo al que pertenece una tabla. */
function MODULO_DE_(tabla) {
  var mods = MODULOS_();
  var salida = '';
  Object.keys(mods).forEach(function (m) {
    if (mods[m].tablas.indexOf(tabla) >= 0) { salida = m; }
  });
  return salida;
}

/**
 * Niveles de acceso. Solo describen el rol: los permisos efectivos se leen de la
 * tabla PERMISO y el administrador los edita desde el módulo Permisos.
 * ADMIN es especial: siempre tiene acceso total y no se puede recortar.
 */
function NIVELES_() {
  return {
    ADMIN: {
      etiqueta: 'Administrador', orden: 1, total: true,
      descripcion: 'Acceso total a todos los módulos, incluida la matriz de permisos.'
    },
    SUPERVISOR: {
      etiqueta: 'Supervisor', orden: 2,
      descripcion: 'Aprueba ausencias y publica el calendario.'
    },
    EDITOR: {
      etiqueta: 'Programador', orden: 3,
      descripcion: 'Arma el calendario y registra ausencias, sin publicar.'
    },
    LECTOR: {
      etiqueta: 'Consulta', orden: 4,
      descripcion: 'Solo visualiza.'
    }
  };
}

/** Permisos con los que se siembra la tabla PERMISO. Después se editan en pantalla. */
function PERMISOS_INICIALES_() {
  return {
    SUPERVISOR: {
      CALENDARIO: ['VER', 'CREAR', 'EDITAR', 'ANULAR', 'PUBLICAR'],
      AUSENCIAS: ['VER', 'CREAR', 'EDITAR', 'ANULAR'],
      PERSONAL: ['VER', 'EDITAR'],
      MAESTROS: ['VER'],
      SEGURIDAD: [],
      PERMISOS: [],
      AUDITORIA: ['VER']
    },
    EDITOR: {
      CALENDARIO: ['VER', 'CREAR', 'EDITAR'],
      AUSENCIAS: ['VER', 'CREAR', 'EDITAR'],
      PERSONAL: ['VER'],
      MAESTROS: ['VER'],
      SEGURIDAD: [],
      PERMISOS: [],
      AUDITORIA: []
    },
    LECTOR: {
      CALENDARIO: ['VER'],
      AUSENCIAS: ['VER'],
      PERSONAL: ['VER'],
      MAESTROS: ['VER'],
      SEGURIDAD: [],
      PERMISOS: [],
      AUDITORIA: []
    }
  };
}

/** Valores de catálogo usados en validaciones y listas desplegables. */
function CATALOGOS_() {
  return {
    ESTADO_GENERAL: ['ACTIVO', 'INACTIVO'],
    ESTADO_SOLICITUD: ['PENDIENTE', 'APROBADO', 'RECHAZADO', 'ANULADO'],
    ESTADO_PROGRAMACION: ['BORRADOR', 'PUBLICADO', 'ANULADO'],
    TIPO_TURNO: ['DIURNO', 'NOCTURNO', 'MIXTO', 'GUARDIA'],
    DIA_SEMANA: ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'],
    NIVEL_ACCESO: ['ADMIN', 'SUPERVISOR', 'EDITOR', 'LECTOR'],
    SI_NO: ['SI', 'NO'],
    ESTADO_CREDENCIAL: ['ACTIVA', 'BLOQUEADA', 'INACTIVA'],
    ESTADO_SESION: ['ABIERTA', 'CERRADA', 'EXPIRADA'],
    MODULO: ['CALENDARIO', 'AUSENCIAS', 'PERSONAL', 'MAESTROS', 'SEGURIDAD', 'PERMISOS', 'AUDITORIA']
  };
}

/**
 * Tipos de día que el motor de reglas genera automáticamente.
 * El código debe existir en la hoja TIPO_DIA (lo siembra instalar()).
 */
function TIPOS_DIA_SISTEMA_() {
  return {
    TRABAJO:          { nombre: 'TRABAJO',          color: '#1F5F8B', bloquea: false },
    DESCANSO:         { nombre: 'DESCANSO',         color: '#6B7A8C', bloquea: false },
    VACACIONES:       { nombre: 'VACACIONES',       color: '#0F8A6E', bloquea: true },
    DESCANSO_MEDICO:  { nombre: 'DESCANSO_MEDICO',  color: '#B3261E', bloquea: true },
    COMPENSATORIO:    { nombre: 'COMPENSATORIO',    color: '#7A5AA8', bloquea: true },
    CUMPLEANIOS:      { nombre: 'CUMPLEANIOS',      color: '#C77A0A', bloquea: true },
    CAPACITACION:     { nombre: 'CAPACITACION',     color: '#3D7A5A', bloquea: false },
    LICENCIA:         { nombre: 'LICENCIA',         color: '#4A5568', bloquea: true }
  };
}

/**
 * Definición del esquema. Cada campo declara tipo, si es requerido y su referencia.
 * tipo: texto | textoLargo | numero | fecha | hora | lista | ref | correo | booleano
 */
function ESQUEMA_() {
  var C = CATALOGOS_();
  return {
    PERSONAL: {
      hoja: 'PERSONAL', pk: 'IDPERSONAL', prefijo: 'PER', etiqueta: 'Personal',
      grupo: 'Maestros', muestra: ['APELLIDOS', 'NOMBRES'], estado: 'ESTADO_PERSONAL',
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
        { c: 'ESTADO_PERSONAL', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },
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
      hoja: 'AREA', pk: 'IDAREA', prefijo: 'ARE', etiqueta: 'Áreas',
      grupo: 'Maestros', muestra: ['AREA'], estado: 'ESTADO_AREA',
      campos: [
        { c: 'IDAREA', t: 'texto', pk: true },
        { c: 'AREA', t: 'texto', req: true, unico: true },
        { c: 'ESTADO_AREA', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
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
        { c: 'TIPO_TURNO', t: 'lista', ops: C.TIPO_TURNO, req: true },
        { c: 'ESTADO_TURNO', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },
    AREA_TURNO: {
      hoja: 'AREA_TURNO', pk: 'IDAREA_TURNO', prefijo: 'ATU', etiqueta: 'Turnos por área',
      grupo: 'Maestros', muestra: ['IDAREA', 'IDTURNO'], estado: 'ESTADO',
      campos: [
        { c: 'IDAREA_TURNO', t: 'texto', pk: true },
        { c: 'IDAREA', t: 'ref', ref: 'AREA', req: true },
        { c: 'IDTURNO', t: 'ref', ref: 'TURNO', req: true },
        { c: 'ESTADO', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },
    PERSONAL_AREA: {
      hoja: 'PERSONAL_AREA', pk: 'IDPERSONAL_AREA', prefijo: 'PAR', etiqueta: 'Asignación a área',
      grupo: 'Maestros', muestra: ['IDPERSONAL', 'IDAREA'], estado: 'ESTADO',
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
    TIPO_DIA: {
      hoja: 'TIPO_DIA', pk: 'IDTIPO_DIA', prefijo: 'TDI', etiqueta: 'Tipos de día',
      grupo: 'Maestros', muestra: ['TIPO_DIA'], estado: 'ESTADO_TIPO',
      campos: [
        { c: 'IDTIPO_DIA', t: 'texto', pk: true },
        { c: 'TIPO_DIA', t: 'texto', req: true, unico: true },
        { c: 'ESTADO_TIPO', t: 'lista', ops: C.ESTADO_GENERAL, req: true, def: 'ACTIVO' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },
    VACACIONES: {
      hoja: 'VACACIONES', pk: 'IDVACACIONES', prefijo: 'VAC', etiqueta: 'Vacaciones',
      grupo: 'Ausencias', muestra: ['IDPERSONAL', 'FECHA_INICIO'], estado: 'ESTADO_VACACIONES',
      campos: [
        { c: 'IDVACACIONES', t: 'texto', pk: true },
        { c: 'IDPERSONAL', t: 'ref', ref: 'PERSONAL', req: true },
        { c: 'FECHA_INICIO', t: 'fecha', req: true },
        { c: 'DIAS', t: 'numero', req: true, min: 1, max: 60 },
        { c: 'FECHA_FIN', t: 'fecha', req: true, calculado: true },
        { c: 'ESTADO_VACACIONES', t: 'lista', ops: C.ESTADO_SOLICITUD, req: true, def: 'PENDIENTE' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },
    DESCANSO_MEDICO: {
      hoja: 'DESCANSO_MEDICO', pk: 'IDDESCANSO_MEDICO', prefijo: 'DME', etiqueta: 'Descanso médico',
      grupo: 'Ausencias', muestra: ['IDPERSONAL', 'FECHA_INICIO'], estado: 'ESTADO_DESCANSO',
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
      hoja: 'COMPENSATORIO', pk: 'IDCOMPENSATORIO', prefijo: 'COM', etiqueta: 'Compensatorios',
      grupo: 'Ausencias', muestra: ['IDPERSONAL', 'FECHA_COMPENSATORIO'], estado: 'ESTADO_COMPENSATORIO',
      campos: [
        { c: 'IDCOMPENSATORIO', t: 'texto', pk: true },
        { c: 'IDPERSONAL', t: 'ref', ref: 'PERSONAL', req: true },
        { c: 'FECHA_GENERACION', t: 'fecha', req: true },
        { c: 'FECHA_COMPENSATORIO', t: 'fecha' },
        { c: 'ESTADO_COMPENSATORIO', t: 'lista', ops: C.ESTADO_SOLICITUD, req: true, def: 'PENDIENTE' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },
    CUMPLEANIOS: {
      hoja: 'CUMPLEANIOS', pk: 'IDCUMPLEANIOS', prefijo: 'CUM', etiqueta: 'Día de cumpleaños',
      grupo: 'Ausencias', muestra: ['IDPERSONAL', 'ANIO_BENEFICIO'], estado: 'ESTADO_BENEFICIO',
      campos: [
        { c: 'IDCUMPLEANIOS', t: 'texto', pk: true },
        { c: 'IDPERSONAL', t: 'ref', ref: 'PERSONAL', req: true },
        { c: 'FECHA_BENEFICIO', t: 'fecha' },
        { c: 'ESTADO_BENEFICIO', t: 'lista', ops: C.ESTADO_SOLICITUD, req: true, def: 'PENDIENTE' },
        { c: 'ANIO_BENEFICIO', t: 'numero', req: true, min: 2000, max: 2100 },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },
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
        { c: 'ESTADO_PROGRAMACION', t: 'lista', ops: C.ESTADO_PROGRAMACION, req: true, def: 'BORRADOR' },
        { c: 'OBSERVACIONES', t: 'textoLargo' }
      ]
    },
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
      // Nunca se expone por la API genérica: contiene material de contraseña.
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
}

/** Orden en que se crean las hojas. */
function ORDEN_HOJAS_() {
  return ['CARGO', 'AREA', 'TURNO', 'AREA_TURNO', 'TIPO_DIA', 'PERSONAL', 'PERSONAL_AREA',
          'VACACIONES', 'DESCANSO_MEDICO', 'COMPENSATORIO', 'CUMPLEANIOS',
          'CALENDARIO_PERSONAL', 'USUARIO', 'CREDENCIAL', 'SESION', 'PERMISO', 'AUDITORIA'];
}

function SS_() {
  var id = CONFIG_().SPREADSHEET_ID;
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
