/**
 * 14_Mantenimiento.gs
 * Herramientas de mantenimiento del sistema.
 *
 * DÓNDE SE EJECUTAN: menú "Sistema de Turnos" de la hoja de cálculo, o desde el
 * Editor Apps Script eligiendo la función y pulsando Ejecutar. El resultado se lee
 * en el panel "Registro de ejecución".
 *
 * Contiene solo tres funciones públicas:
 *   repararAcceso()           - devuelve el acceso cuando nadie puede entrar
 *   sincronizarValidaciones() - reasigna las listas desplegables a su columna
 *   restablecerSistema()      - deja el sistema vacío, listo para cargar datos
 */

/* ------------------------------------------------------------------ */
/* Restablecer                                                         */
/* ------------------------------------------------------------------ */

/** Tablas cuyo contenido se borra al restablecer. */
function TABLAS_DE_DATOS_() {
  return ['AREA', 'AREA_TURNO', 'COBERTURA_AREA', 'FERIADO',
          'PERSONAL', 'PERSONAL_AREA',
          'CALENDARIO_PERSONAL', 'ROL_TURNO_AREA', 'REEMPLAZO',
          'VACACIONES', 'DESCANSO_MEDICO', 'COMPENSATORIO', 'LICENCIA', 'CUMPLEANIOS',
          'USUARIO', 'CREDENCIAL', 'SESION', 'AUDITORIA'];
}

/** Tablas que se conservan: son catálogos del sistema, no datos operativos. */
function TABLAS_DE_CATALOGO_() {
  return ['CARGO', 'TURNO', 'TIPO_DIA', 'FUNCION', 'TIPO_LICENCIA', 'PARAMETRO', 'PERMISO'];
}

/**
 * Deja el sistema vacío conservando la estructura: borra juzgados, personal,
 * programación, incidencias, usuarios y auditoría, y mantiene los catálogos
 * (cargos, turnos, tipos de día, funciones, tipos de licencia, parámetros y la
 * matriz de permisos). Recrea el administrador con una contraseña temporal.
 *
 * Exige confirmación escrita, así que solo funciona desde el menú de la hoja:
 * es una acción irreversible y no debe poder dispararse por accidente.
 */
function restablecerSistema() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (ignore) { ui = null; }

  if (!ui) {
    throw new Error('Ejecuta esta función desde el menú de la hoja de cálculo ' +
                    '(Sistema de Turnos → Restablecer sistema sin datos). ' +
                    'Necesita confirmación escrita y desde el editor no puede pedirla.');
  }

  var aviso = 'Se borrarán TODOS los datos:\n\n' +
              '· Juzgados, turnos por juzgado y cobertura\n' +
              '· Personal y sus asignaciones\n' +
              '· Toda la programación del calendario\n' +
              '· Vacaciones, descansos, compensatorios, licencias y cumpleaños\n' +
              '· Usuarios, credenciales y auditoría\n\n' +
              'Se conservan: cargos, turnos, tipos de día, funciones, tipos de licencia, ' +
              'parámetros y la matriz de permisos.\n\n' +
              'Esta acción NO se puede deshacer.\n\n' +
              'Escribe BORRAR para confirmar:';

  var respuesta = ui.prompt('Restablecer el sistema sin datos', aviso, ui.ButtonSet.OK_CANCEL);
  if (respuesta.getSelectedButton() !== ui.Button.OK) { return 'Cancelado.'; }
  if (String(respuesta.getResponseText()).trim().toUpperCase() !== 'BORRAR') {
    ui.alert('Cancelado', 'No escribiste BORRAR. No se modificó nada.', ui.ButtonSet.OK);
    return 'Cancelado: confirmación incorrecta.';
  }

  var resultado = restablecerDatos_();
  ui.alert('Sistema restablecido',
    resultado.borradas + ' tabla(s) vaciadas.\n\n' +
    'Usuario: ' + resultado.usuarioLogin + '\n' +
    'Contraseña temporal: ' + resultado.claveTemporal + '\n\n' +
    'Anótala: no se puede volver a mostrar.', ui.ButtonSet.OK);
  return resultado.texto;
}

/**
 * Hace el trabajo del restablecimiento. Separada de la confirmación para poder
 * probarla y para poder invocarla desde un proceso sin interfaz si hiciera falta.
 */
function restablecerDatos_() {
  var ss = SS_();
  var esquema = ESQUEMA_();
  var lineas = [];
  var borradas = 0;

  TABLAS_DE_DATOS_().forEach(function (clave) {
    var def = esquema[clave];
    var hoja = ss.getSheetByName(def.hoja);
    if (!hoja) { return; }
    var ultima = hoja.getLastRow();
    if (ultima < 2) { lineas.push('  ' + def.hoja + ': ya estaba vacía'); return; }

    var filas = ultima - 1;
    var ancho = Math.max(hoja.getLastColumn(), 1);
    // Se limpia el contenido, no se borran filas: así se conservan encabezados,
    // formatos y listas desplegables tal como están.
    hoja.getRange(2, 1, filas, ancho).clearContent();
    lineas.push('  ' + def.hoja + ': ' + filas + ' fila(s) borradas');
    borradas++;
  });

  SpreadsheetApp.flush();

  // Los catálogos se conservan, pero se rellenan si faltara alguno.
  sembrarCatalogos_();
  Permisos_.sembrar();
  Permisos_.invalidar();
  lineas.push('  Catálogos verificados: ' + TABLAS_DE_CATALOGO_().join(', '));

  var acceso = crearAdministrador_();
  lineas.push('  Administrador recreado: ' + acceso.usuarioLogin);

  Auditoria_.registrar(
    { correo: Session.getEffectiveUser().getEmail(), nivel: 'ADMIN', origen: 'MANTENIMIENTO' },
    'RESTABLECER', 'SISTEMA', '', '', '', '', 'OK',
    'Sistema restablecido sin datos. Tablas vaciadas: ' + borradas);

  var texto = 'SISTEMA RESTABLECIDO  ' + Utilidades_.ahora() + '\n' + '='.repeat(52) + '\n' +
              lineas.join('\n') + '\n' + '='.repeat(52) +
              '\nUsuario: ' + acceso.usuarioLogin +
              '\nContraseña temporal: ' + acceso.claveTemporal +
              '\n\nSiguiente paso: cargar juzgados, turnos por juzgado y personal.';
  console.log(texto);

  return {
    borradas: borradas,
    usuarioLogin: acceso.usuarioLogin,
    claveTemporal: acceso.claveTemporal,
    texto: texto
  };
}

/** Crea el administrador desde cero y devuelve su contraseña temporal. */
function crearAdministrador_() {
  var correo = CONFIG_().ADMIN_INICIAL || Session.getEffectiveUser().getEmail() || 'admin@local';
  var cargo = Db_.leer('CARGO')[0];

  var persona = Db_.insertarCrudo('PERSONAL', {
    IDCARGO: cargo ? cargo.IDCARGO : '',
    DNI: '00000000', NOMBRES: 'Administrador', APELLIDOS: 'del Sistema',
    TELEFONO: '', CORREO: correo,
    FECHA_NAC: '1990-01-01', FECHA_INGRESO: Utilidades_.hoyISO(),
    FECHA_CESE: '', ESTADO_PERSONAL: 'ACTIVO', OBSERVACIONES: 'Usuario inicial'
  });
  var usuario = Db_.insertarCrudo('USUARIO', {
    IDPERSONAL: persona.IDPERSONAL, NIVEL_ACCESO: 'ADMIN',
    ESTADO_USUARIO: 'ACTIVO', OBSERVACIONES: 'Usuario inicial'
  });

  var temporal = Politica_.temporal();
  var salt = Cripto_.salt();
  var iter = SEGURIDAD_().ITERACIONES;
  Seg_.crear('CREDENCIAL', {
    IDUSUARIO: usuario.IDUSUARIO, USUARIO_LOGIN: 'admin',
    HASH: Cripto_.derivar(temporal, salt, iter), SALT: salt, ITERACIONES: iter,
    HISTORIAL: '[]', DEBE_CAMBIAR: 'SI', FECHA_CAMBIO: Utilidades_.ahora(),
    INTENTOS_FALLIDOS: 0, BLOQUEADO_HASTA: '', ULTIMO_ACCESO: '',
    ESTADO_CREDENCIAL: 'ACTIVA', OBSERVACIONES: 'Credencial inicial'
  });

  return { usuarioLogin: 'admin', claveTemporal: temporal };
}

/* ------------------------------------------------------------------ */
/* Validaciones                                                        */
/* ------------------------------------------------------------------ */

/**
 * Reasigna las listas desplegables a la columna que les corresponde POR NOMBRE.
 *
 * Las reglas de validación viven pegadas a la posición de la columna, no a su
 * encabezado. Si el orden de la hoja cambió, la lista de ESTADO_AREA puede haber
 * quedado sobre COBERTURA_MINIMA y rechazar cualquier número que se escriba ahí.
 * No toca ningún dato: solo reglas de validación.
 */
function sincronizarValidaciones() {
  var ss = SS_();
  var esquema = ESQUEMA_();
  var ajustadas = [];

  ORDEN_HOJAS_().forEach(function (clave) {
    var def = esquema[clave];
    var hoja = ss.getSheetByName(def.hoja);
    if (!hoja) { return; }

    var ancho = Math.max(hoja.getLastColumn(), 1);
    var filas = Math.max(hoja.getMaxRows() - 1, 1);
    var cabeceras = hoja.getRange(1, 1, 1, ancho).getValues()[0]
                        .map(function (v) { return String(v).trim(); });

    var porNombre = {};
    def.campos.forEach(function (f) { porNombre[f.c] = f; });

    for (var col = 1; col <= ancho; col++) {
      var campo = porNombre[cabeceras[col - 1]];
      var rango = hoja.getRange(2, col, filas, 1);

      if (campo && campo.t === 'lista' && campo.ops && campo.ops.length) {
        rango.setDataValidation(
          SpreadsheetApp.newDataValidation()
            .requireValueInList(campo.ops, true)
            .setAllowInvalid(false)
            .setHelpText('Valores permitidos: ' + campo.ops.join(', '))
            .build());
      } else {
        rango.clearDataValidations();
      }
    }
    ajustadas.push(def.hoja);
  });

  SpreadsheetApp.flush();
  console.log('Validaciones sincronizadas en ' + ajustadas.length + ' hoja(s).');
  return ajustadas;
}

/* ------------------------------------------------------------------ */
/* Acceso                                                              */
/* ------------------------------------------------------------------ */

/**
 * Devuelve el acceso al sistema cuando nadie puede entrar, sea cual sea el mensaje.
 * Reconstruye la cadena PERSONAL → USUARIO → CREDENCIAL, que es lo único que hace
 * falta para iniciar sesión, y comprueba de verdad que el ingreso funciona antes
 * de entregar la contraseña.
 */
function repararAcceso() {
  var log = [];
  var anotar = function (t) { log.push(t); console.log(t); };

  anotar('REPARACIÓN DEL ACCESO  ' + Utilidades_.ahora());
  anotar('='.repeat(56));

  try {
    sincronizarValidaciones();
    anotar('Listas desplegables sincronizadas.');
  } catch (e) {
    anotar('Aviso al sincronizar listas: ' + e.message);
  }

  var faltantes = [];
  ORDEN_HOJAS_().forEach(function (clave) {
    if (!SS_().getSheetByName(ESQUEMA_()[clave].hoja)) { faltantes.push(clave + ' (falta la hoja)'); return; }
    var faltan = Db_.columnasFaltantes(clave);
    if (faltan.length) { faltantes.push(clave + ': ' + faltan.join(', ')); }
  });
  anotar(faltantes.length
    ? 'Columnas faltantes → ejecuta migrarAVersion2: ' + faltantes.join(' | ')
    : 'Todas las hojas tienen sus columnas.');

  var personas = Db_.leer('PERSONAL');
  var usuarios = Db_.leer('USUARIO');
  var credenciales = Db_.leer('CREDENCIAL');

  anotar('');
  anotar('ESTADO ACTUAL');
  anotar('  PERSONAL: ' + personas.length + ' fila(s)');
  personas.slice(0, 5).forEach(function (p) {
    anotar('    ' + p.IDPERSONAL + ' | ' + p.NOMBRES + ' ' + p.APELLIDOS +
           ' | ' + p.CORREO + ' | estado: "' + p.ESTADO_PERSONAL + '"');
  });
  anotar('  USUARIO: ' + usuarios.length + ' fila(s)');
  usuarios.slice(0, 5).forEach(function (u) {
    anotar('    ' + u.IDUSUARIO + ' | personal: "' + u.IDPERSONAL +
           '" | nivel: "' + u.NIVEL_ACCESO + '" | estado: "' + u.ESTADO_USUARIO + '"');
  });
  anotar('  CREDENCIAL: ' + credenciales.length + ' fila(s)');
  credenciales.slice(0, 5).forEach(function (c) {
    anotar('    ' + c.IDCREDENCIAL + ' | login: "' + c.USUARIO_LOGIN +
           '" | usuario: "' + c.IDUSUARIO + '" | estado: "' + c.ESTADO_CREDENCIAL + '"');
  });

  anotar('');
  anotar('REPARACIÓN');
  var correo = CONFIG_().ADMIN_INICIAL || Session.getEffectiveUser().getEmail() || 'admin@local';

  var persona = personas.filter(function (p) { return p.IDPERSONAL && p.NOMBRES; })[0];
  if (!persona) {
    var cargo = Db_.leer('CARGO')[0];
    persona = Db_.insertarCrudo('PERSONAL', {
      IDCARGO: cargo ? cargo.IDCARGO : '',
      DNI: '00000000', NOMBRES: 'Administrador', APELLIDOS: 'del Sistema',
      TELEFONO: '', CORREO: correo,
      FECHA_NAC: '1990-01-01', FECHA_INGRESO: Utilidades_.hoyISO(),
      FECHA_CESE: '', ESTADO_PERSONAL: 'ACTIVO',
      OBSERVACIONES: 'Recreado por repararAcceso()'
    });
    anotar('  PERSONAL recreado: ' + persona.IDPERSONAL);
  } else {
    var arreglos = {};
    if (String(persona.ESTADO_PERSONAL).toUpperCase() !== 'ACTIVO') { arreglos.ESTADO_PERSONAL = 'ACTIVO'; }
    if (persona.FECHA_CESE) { arreglos.FECHA_CESE = ''; }
    if (!persona.CORREO) { arreglos.CORREO = correo; }
    if (Object.keys(arreglos).length) {
      Seg_.guardar('PERSONAL', persona.IDPERSONAL, arreglos);
      anotar('  PERSONAL ' + persona.IDPERSONAL + ' corregido: ' + Object.keys(arreglos).join(', '));
    } else {
      anotar('  PERSONAL ' + persona.IDPERSONAL + ' está correcto.');
    }
  }

  var usuario = usuarios.filter(function (u) {
    return u.IDPERSONAL === persona.IDPERSONAL;
  })[0] || usuarios[0];

  if (!usuario) {
    usuario = Db_.insertarCrudo('USUARIO', {
      IDPERSONAL: persona.IDPERSONAL, NIVEL_ACCESO: 'ADMIN',
      ESTADO_USUARIO: 'ACTIVO', OBSERVACIONES: 'Recreado por repararAcceso()'
    });
    anotar('  USUARIO recreado: ' + usuario.IDUSUARIO);
  } else {
    var arr2 = {};
    if (usuario.IDPERSONAL !== persona.IDPERSONAL) { arr2.IDPERSONAL = persona.IDPERSONAL; }
    if (String(usuario.NIVEL_ACCESO).toUpperCase() !== 'ADMIN') { arr2.NIVEL_ACCESO = 'ADMIN'; }
    if (String(usuario.ESTADO_USUARIO).toUpperCase() !== 'ACTIVO') { arr2.ESTADO_USUARIO = 'ACTIVO'; }
    if (Object.keys(arr2).length) {
      Seg_.guardar('USUARIO', usuario.IDUSUARIO, arr2);
      anotar('  USUARIO ' + usuario.IDUSUARIO + ' corregido: ' + Object.keys(arr2).join(', '));
    } else {
      anotar('  USUARIO ' + usuario.IDUSUARIO + ' está correcto.');
    }
  }

  var temporal = Politica_.temporal();
  var salt = Cripto_.salt();
  var iter = SEGURIDAD_().ITERACIONES;
  var hash = Cripto_.derivar(temporal, salt, iter);

  var cred = credenciales.filter(function (c) {
    return c.IDUSUARIO === usuario.IDUSUARIO;
  })[0] || credenciales.filter(function (c) {
    return String(c.USUARIO_LOGIN).toLowerCase() === 'admin';
  })[0];

  if (!cred) {
    cred = Seg_.crear('CREDENCIAL', {
      IDUSUARIO: usuario.IDUSUARIO, USUARIO_LOGIN: 'admin',
      HASH: hash, SALT: salt, ITERACIONES: iter, HISTORIAL: '[]',
      DEBE_CAMBIAR: 'SI', FECHA_CAMBIO: Utilidades_.ahora(),
      INTENTOS_FALLIDOS: 0, BLOQUEADO_HASTA: '', ULTIMO_ACCESO: '',
      ESTADO_CREDENCIAL: 'ACTIVA', OBSERVACIONES: 'Recreada por repararAcceso()'
    });
    anotar('  CREDENCIAL recreada: ' + cred.USUARIO_LOGIN);
  } else {
    Seg_.guardar('CREDENCIAL', cred.IDCREDENCIAL, {
      IDUSUARIO: usuario.IDUSUARIO,
      USUARIO_LOGIN: cred.USUARIO_LOGIN || 'admin',
      SALT: salt, ITERACIONES: iter, HASH: hash, HISTORIAL: '[]',
      DEBE_CAMBIAR: 'SI', FECHA_CAMBIO: Utilidades_.ahora(),
      INTENTOS_FALLIDOS: 0, BLOQUEADO_HASTA: '', ESTADO_CREDENCIAL: 'ACTIVA'
    });
    anotar('  CREDENCIAL ' + (cred.USUARIO_LOGIN || 'admin') + ' restablecida.');
  }

  anotar('');
  anotar('COMPROBACIÓN');
  var login = (Db_.buscarPorId('CREDENCIAL', cred.IDCREDENCIAL) || {}).USUARIO_LOGIN || 'admin';
  var resultado;
  try {
    var sesion = Auth_.iniciarSesion(login, temporal);
    Auth_.cerrarSesion(sesion.token);
    resultado = '  El inicio de sesión FUNCIONA.';
  } catch (e) {
    resultado = '  El inicio de sesión SIGUE FALLANDO: ' + e.message +
                '\n  Copia todo este registro y envíalo para diagnóstico.';
  }
  anotar(resultado);

  var texto = log.join('\n') + '\n' + '='.repeat(56) +
              '\nUsuario: ' + login +
              '\nContraseña temporal: ' + temporal +
              '\n\nAnótala: no se puede volver a mostrar.';

  console.log('\n' + '='.repeat(56) + '\nUsuario: ' + login +
              '\nContraseña temporal: ' + temporal);
  try {
    SpreadsheetApp.getUi().alert('Acceso reparado',
      'Usuario: ' + login + '\nContraseña temporal: ' + temporal +
      '\n\n' + resultado.trim(), SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (ignore) { /* desde el editor basta el registro */ }

  return texto;
}
