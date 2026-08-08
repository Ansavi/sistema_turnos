/**
 * 05_Auth.gs
 * Identidad y sesión.
 *
 * Las contraseñas NUNCA se guardan en claro: se almacena el hash derivado con
 * HMAC-SHA256 sobre un salt aleatorio por usuario, repetido N veces (SEGURIDAD_().ITERACIONES).
 * La sesión se identifica con un token aleatorio del que solo se guarda su hash,
 * igual que una contraseña: si alguien lee la hoja SESION no puede suplantar a nadie.
 */

/* ------------------------------------------------------------------ */
/* Criptografía                                                        */
/* ------------------------------------------------------------------ */
var Cripto_ = {

  salt: function () {
    return Utilities.base64Encode(Utilities.getUuid() + Utilities.getUuid()).substring(0, 32);
  },

  token: function () {
    return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  },

  sha256: function (texto) {
    return Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(texto), Utilities.Charset.UTF_8));
  },

  /** Derivación con estiramiento: encarece el ataque por fuerza bruta sobre la hoja. */
  derivar: function (clave, salt, iteraciones) {
    var llave = Utilities.newBlob(String(salt)).getBytes();
    var bytes = Utilities.newBlob(String(salt) + '|' + String(clave)).getBytes();
    var n = Number(iteraciones) || SEGURIDAD_().ITERACIONES;
    for (var i = 0; i < n; i++) {
      bytes = Utilities.computeHmacSha256Signature(bytes, llave);
    }
    return Utilities.base64Encode(bytes);
  },

  /** Comparación de tiempo constante: no filtra información por cuánto tarda. */
  iguales: function (a, b) {
    a = String(a || ''); b = String(b || '');
    if (a.length !== b.length) { return false; }
    var dif = 0;
    for (var i = 0; i < a.length; i++) { dif |= (a.charCodeAt(i) ^ b.charCodeAt(i)); }
    return dif === 0;
  }
};

/* ------------------------------------------------------------------ */
/* Política de contraseñas                                             */
/* ------------------------------------------------------------------ */
var Politica_ = {

  validar: function (clave, usuarioLogin) {
    var s = SEGURIDAD_();
    var e = [];
    clave = String(clave || '');

    if (clave.length < s.LARGO_MINIMO) { e.push('Debe tener al menos ' + s.LARGO_MINIMO + ' caracteres.'); }
    if (s.EXIGE_MAYUSCULA && !/[A-ZÁÉÍÓÚÑ]/.test(clave)) { e.push('Debe incluir una letra mayúscula.'); }
    if (s.EXIGE_MINUSCULA && !/[a-záéíóúñ]/.test(clave)) { e.push('Debe incluir una letra minúscula.'); }
    if (s.EXIGE_NUMERO && !/[0-9]/.test(clave)) { e.push('Debe incluir un número.'); }
    if (s.EXIGE_SIMBOLO && !/[^A-Za-z0-9]/.test(clave)) { e.push('Debe incluir un símbolo.'); }
    if (usuarioLogin && clave.toLowerCase().indexOf(String(usuarioLogin).toLowerCase()) >= 0) {
      e.push('No puede contener tu nombre de usuario.');
    }
    if (/^(.)\1+$/.test(clave)) { e.push('No puede ser un solo carácter repetido.'); }

    return e;
  },

  /** Contraseña temporal legible pero fuerte, para la entrega inicial. */
  temporal: function () {
    var may = 'ABCDEFGHJKLMNPQRSTUVWXYZ', min = 'abcdefghijkmnopqrstuvwxyz', num = '23456789';
    var todo = may + min + num;
    var largo = SEGURIDAD_().CLAVE_TEMPORAL_LARGO;
    var out = [
      may.charAt(Math.floor(Math.random() * may.length)),
      min.charAt(Math.floor(Math.random() * min.length)),
      num.charAt(Math.floor(Math.random() * num.length))
    ];
    for (var i = out.length; i < largo; i++) {
      out.push(todo.charAt(Math.floor(Math.random() * todo.length)));
    }
    return out.sort(function () { return Math.random() - 0.5; }).join('');
  }
};

/* ------------------------------------------------------------------ */
/* Escritura sensible: sin volcar hashes a la auditoría                */
/* ------------------------------------------------------------------ */
var Seg_ = {

  guardar: function (tabla, id, cambios) {
    var def = ESQUEMA_()[tabla];
    var actual = Db_.buscarPorId(tabla, id);
    if (!actual) { throw new Error('No existe ' + id + ' en ' + tabla + '.'); }

    // Por nombre de columna, nunca por posición: la hoja puede tener otro orden.
    var info = Db_._indices(tabla);
    def.campos.forEach(function (f) {
      if (cambios[f.c] === undefined) { return; }
      var col = info.mapa[f.c];
      if (col) { info.hoja.getRange(actual._fila, col).setValue(cambios[f.c]); }
    });
    return Db_.buscarPorId(tabla, id);
  },

  crear: function (tabla, datos) {
    var def = ESQUEMA_()[tabla];
    var hoja = SS_().getSheetByName(def.hoja);
    var reg = {};
    reg[def.pk] = Db_.nuevoId(tabla);
    def.campos.forEach(function (f) {
      if (f.pk) { return; }
      reg[f.c] = datos[f.c] !== undefined ? datos[f.c] : (f.def !== undefined ? f.def : '');
    });
    hoja.appendRow(Db_._aFila(tabla, reg));
    return reg;
  }
};

/* ------------------------------------------------------------------ */
/* Autenticación y sesión                                              */
/* ------------------------------------------------------------------ */
var Auth_ = {

  /* ---------- Perfiles ---------- */

  perfilPorIdUsuario: function (idUsuario) {
    var usuario = Db_.buscarPorId('USUARIO', idUsuario);
    if (!usuario) { return null; }
    return this._armarPerfil(usuario);
  },

  perfilPorCorreo: function (correo) {
    if (!correo) { return null; }
    var persona = Db_.buscarPor('PERSONAL', 'CORREO', correo);
    if (!persona) { return null; }
    var usuario = Db_.buscarPor('USUARIO', 'IDPERSONAL', persona.IDPERSONAL);
    if (!usuario) { return null; }
    return this._armarPerfil(usuario, persona);
  },

  _armarPerfil: function (usuario, persona) {
    persona = persona || Db_.buscarPorId('PERSONAL', usuario.IDPERSONAL);
    if (!persona) { return null; }
    var nivel = String(usuario.NIVEL_ACCESO || 'LECTOR').toUpperCase();
    if (!NIVELES_()[nivel]) { nivel = 'LECTOR'; }

    return {
      idUsuario: usuario.IDUSUARIO,
      idPersonal: persona.IDPERSONAL,
      correo: String(persona.CORREO || '').toLowerCase(),
      nombre: persona.NOMBRES + ' ' + persona.APELLIDOS,
      nivel: nivel,
      etiquetaNivel: NIVELES_()[nivel].etiqueta,
      activo: String(persona.ESTADO_PERSONAL).toUpperCase() === 'ACTIVO' &&
              String(usuario.ESTADO_USUARIO).toUpperCase() === 'ACTIVO',
      origen: 'APP',
      // Compatibilidad con los módulos que consultan ctx.permisos directamente.
      permisos: {
        publicar: Permisos_.puede(nivel, 'CALENDARIO', 'PUBLICAR'),
        auditoria: Permisos_.puede(nivel, 'AUDITORIA', 'VER'),
        gestionUsuarios: Permisos_.puede(nivel, 'SEGURIDAD', 'ADMINISTRAR')
      }
    };
  },

  correoActivo: function () {
    var correo = '';
    try { correo = Session.getActiveUser().getEmail(); } catch (ignore) {}
    return String(correo || '').toLowerCase().trim();
  },

  /* ---------- Ingreso ---------- */

  /**
   * Valida usuario y contraseña. Devuelve el token de sesión.
   * El mensaje de error es el mismo para usuario inexistente y contraseña incorrecta:
   * no se le confirma a un atacante qué usuarios existen.
   */
  iniciarSesion: function (usuarioLogin, clave) {
    var s = SEGURIDAD_();
    var generico = 'Usuario o contraseña incorrectos.';
    var login = String(usuarioLogin || '').trim().toLowerCase();
    var ctxAnon = { correo: login, origen: 'APP' };

    if (!login || !clave) { throw new Error('Ingresa tu usuario y contraseña.'); }

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var cred = Db_.buscarPor('CREDENCIAL', 'USUARIO_LOGIN', login);
      if (!cred) {
        Auditoria_.registrar(ctxAnon, 'INGRESO', 'CREDENCIAL', '', '', '', '', 'DENEGADO',
          'Usuario inexistente: ' + login);
        // Costo similar al de una verificación real, para no delatar por tiempo.
        Cripto_.derivar(clave, 'inexistente', s.ITERACIONES);
        throw new Error(generico);
      }

      var estado = String(cred.ESTADO_CREDENCIAL).toUpperCase();
      if (estado === 'INACTIVA') {
        Auditoria_.registrar(ctxAnon, 'INGRESO', 'CREDENCIAL', cred.IDCREDENCIAL, '', '', '',
          'DENEGADO', 'Credencial inactiva');
        throw new Error('Tu acceso está desactivado. Comunícate con el administrador.');
      }

      var ahora = Utilidades_.ahora();
      if (cred.BLOQUEADO_HASTA && String(cred.BLOQUEADO_HASTA) > ahora) {
        Auditoria_.registrar(ctxAnon, 'INGRESO', 'CREDENCIAL', cred.IDCREDENCIAL, '', '', '',
          'DENEGADO', 'Cuenta bloqueada hasta ' + cred.BLOQUEADO_HASTA);
        throw new Error('Cuenta bloqueada por intentos fallidos. Vuelve a intentar después de las ' +
                        String(cred.BLOQUEADO_HASTA).substring(11, 16) + ' o pide al administrador que te desbloquee.');
      }

      var calculado = Cripto_.derivar(clave, cred.SALT, cred.ITERACIONES);
      if (!Cripto_.iguales(calculado, cred.HASH)) {
        var fallidos = Number(cred.INTENTOS_FALLIDOS || 0) + 1;
        var cambios = { INTENTOS_FALLIDOS: fallidos };
        var detalle = 'Contraseña incorrecta. Intento ' + fallidos + ' de ' + s.INTENTOS_MAXIMOS;

        if (fallidos >= s.INTENTOS_MAXIMOS) {
          var hasta = new Date(new Date().getTime() + s.MINUTOS_BLOQUEO * 60000);
          cambios.BLOQUEADO_HASTA = Utilities.formatDate(hasta, CONFIG_().TZ, 'yyyy-MM-dd HH:mm:ss');
          cambios.ESTADO_CREDENCIAL = 'BLOQUEADA';
          cambios.INTENTOS_FALLIDOS = 0;
          detalle = 'Cuenta bloqueada por ' + s.MINUTOS_BLOQUEO + ' minutos tras ' + s.INTENTOS_MAXIMOS + ' intentos.';
        }
        Seg_.guardar('CREDENCIAL', cred.IDCREDENCIAL, cambios);
        Auditoria_.registrar(ctxAnon, 'INGRESO', 'CREDENCIAL', cred.IDCREDENCIAL, '', '', '',
          'DENEGADO', detalle);
        throw new Error(fallidos >= s.INTENTOS_MAXIMOS
          ? 'Demasiados intentos fallidos. Tu cuenta quedó bloqueada por ' + s.MINUTOS_BLOQUEO + ' minutos.'
          : generico);
      }

      var perfil = this.perfilPorIdUsuario(cred.IDUSUARIO);
      if (!perfil) {
        Auditoria_.registrar(ctxAnon, 'INGRESO', 'CREDENCIAL', cred.IDCREDENCIAL, '', '', '',
          'DENEGADO', 'Credencial sin usuario o personal asociado');
        throw new Error('Tu usuario no está bien configurado. Comunícate con el administrador.');
      }
      if (!perfil.activo) {
        Auditoria_.registrar(ctxAnon, 'INGRESO', 'USUARIO', perfil.idUsuario, '', '', '',
          'DENEGADO', 'Usuario o personal inactivo');
        throw new Error('Tu usuario está inactivo. Comunícate con el administrador.');
      }

      Seg_.guardar('CREDENCIAL', cred.IDCREDENCIAL, {
        INTENTOS_FALLIDOS: 0, BLOQUEADO_HASTA: '', ULTIMO_ACCESO: ahora,
        ESTADO_CREDENCIAL: 'ACTIVA'
      });

      var sesion = this._abrirSesion(perfil);
      var vencida = this._claveVencida(cred);

      Auditoria_.registrar(perfil, 'INGRESO', 'USUARIO', perfil.idUsuario, '', '', '', 'OK',
        'Sesión ' + sesion.idSesion);

      return {
        token: sesion.token,
        debeCambiarClave: String(cred.DEBE_CAMBIAR).toUpperCase() === 'SI' || vencida,
        motivoCambio: String(cred.DEBE_CAMBIAR).toUpperCase() === 'SI'
          ? 'Es tu primer ingreso o el administrador restableció tu contraseña.'
          : (vencida ? 'Tu contraseña superó los ' + s.DIAS_VIGENCIA_CLAVE + ' días de vigencia.' : ''),
        usuario: this._publico(perfil)
      };
    } finally { lock.releaseLock(); }
  },

  _claveVencida: function (cred) {
    var dias = SEGURIDAD_().DIAS_VIGENCIA_CLAVE;
    if (!dias || !cred.FECHA_CAMBIO) { return false; }
    var limite = Utilidades_.sumarDias(String(cred.FECHA_CAMBIO).substring(0, 10), dias);
    return Utilidades_.hoyISO() > limite;
  },

  _abrirSesion: function (perfil) {
    var token = Cripto_.token();
    var ahora = new Date();
    var expira = new Date(ahora.getTime() + SEGURIDAD_().MINUTOS_SESION * 60000);
    var f = function (d) { return Utilities.formatDate(d, CONFIG_().TZ, 'yyyy-MM-dd HH:mm:ss'); };

    var reg = Seg_.crear('SESION', {
      IDUSUARIO: perfil.idUsuario,
      TOKEN_HASH: Cripto_.sha256(token),
      FECHA_INICIO: f(ahora),
      ULTIMA_ACTIVIDAD: f(ahora),
      FECHA_EXPIRA: f(expira),
      FECHA_CIERRE: '',
      ESTADO_SESION: 'ABIERTA',
      OBSERVACIONES: ''
    });
    return { idSesion: reg.IDSESION, token: token };
  },

  /** Valida el token en cada llamada y renueva la ventana de inactividad. */
  contexto: function (token) {
    if (!token) { throw new Error('SIN_SESION'); }
    var hash = Cripto_.sha256(token);
    var sesion = Db_.buscarPor('SESION', 'TOKEN_HASH', hash);
    if (!sesion) { throw new Error('SIN_SESION'); }

    if (String(sesion.ESTADO_SESION).toUpperCase() !== 'ABIERTA') { throw new Error('SIN_SESION'); }

    var ahora = Utilidades_.ahora();
    if (String(sesion.FECHA_EXPIRA) < ahora) {
      Seg_.guardar('SESION', sesion.IDSESION, { ESTADO_SESION: 'EXPIRADA', FECHA_CIERRE: ahora });
      throw new Error('SESION_EXPIRADA');
    }

    var perfil = this.perfilPorIdUsuario(sesion.IDUSUARIO);
    if (!perfil || !perfil.activo) {
      Seg_.guardar('SESION', sesion.IDSESION, { ESTADO_SESION: 'CERRADA', FECHA_CIERRE: ahora });
      throw new Error('Tu usuario fue desactivado durante la sesión.');
    }

    // Renovar en cada llamada obligaría a escribir en la hoja hasta varias veces por
    // pantalla. Basta con hacerlo cuando pasaron unos minutos desde la última marca.
    var minutosDesde = (new Date().getTime() - this._aFecha(sesion.ULTIMA_ACTIVIDAD)) / 60000;
    if (minutosDesde > 5) {
      var nuevaExpira = new Date(new Date().getTime() + SEGURIDAD_().MINUTOS_SESION * 60000);
      Seg_.guardar('SESION', sesion.IDSESION, {
        ULTIMA_ACTIVIDAD: ahora,
        FECHA_EXPIRA: Utilities.formatDate(nuevaExpira, CONFIG_().TZ, 'yyyy-MM-dd HH:mm:ss')
      });
    }

    perfil.idSesion = sesion.IDSESION;
    return perfil;
  },

  /** 'yyyy-MM-dd HH:mm:ss' a milisegundos, sin depender del parser del navegador. */
  _aFecha: function (texto) {
    var m = String(texto || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) { return 0; }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
                    Number(m[4]), Number(m[5]), Number(m[6])).getTime();
  },

  /** Modo GOOGLE o MIXTO: identifica por la cuenta con la que se abre el enlace. */
  contextoPorGoogle: function () {
    var correo = this.correoActivo();
    if (!correo) { throw new Error('SIN_SESION'); }
    var perfil = this.perfilPorCorreo(correo);
    if (!perfil) {
      Auditoria_.registrar({ correo: correo, origen: 'APP' }, 'ACCESO', 'USUARIO', '', '', '', '',
        'DENEGADO', 'Correo sin usuario registrado');
      throw new Error('Tu cuenta (' + correo + ') no está registrada en el sistema.');
    }
    if (!perfil.activo) { throw new Error('Tu usuario está inactivo.'); }
    return perfil;
  },

  cerrarSesion: function (token) {
    if (!token) { return true; }
    var sesion = Db_.buscarPor('SESION', 'TOKEN_HASH', Cripto_.sha256(token));
    if (!sesion) { return true; }
    Seg_.guardar('SESION', sesion.IDSESION, {
      ESTADO_SESION: 'CERRADA', FECHA_CIERRE: Utilidades_.ahora()
    });
    var perfil = this.perfilPorIdUsuario(sesion.IDUSUARIO);
    Auditoria_.registrar(perfil || {}, 'SALIDA', 'SESION', sesion.IDSESION, '', '', '', 'OK', '');
    return true;
  },

  /* ---------- Gestión de contraseñas ---------- */

  cambiarClave: function (ctx, claveActual, claveNueva) {
    var cred = Db_.buscarPor('CREDENCIAL', 'IDUSUARIO', ctx.idUsuario);
    if (!cred) { throw new Error('Tu usuario no tiene credenciales configuradas.'); }

    var actual = Cripto_.derivar(claveActual, cred.SALT, cred.ITERACIONES);
    if (!Cripto_.iguales(actual, cred.HASH)) {
      Auditoria_.registrar(ctx, 'CAMBIO_CLAVE', 'CREDENCIAL', cred.IDCREDENCIAL, '', '', '',
        'DENEGADO', 'Contraseña actual incorrecta');
      throw new Error('La contraseña actual no es correcta.');
    }

    var errores = Politica_.validar(claveNueva, cred.USUARIO_LOGIN);
    if (errores.length) { throw new Error('La nueva contraseña no cumple la política:\n· ' + errores.join('\n· ')); }

    var historial = [];
    try { historial = JSON.parse(cred.HISTORIAL || '[]'); } catch (ignore) { historial = []; }

    /**
     * El salt se mantiene fijo durante la vida de la credencial (solo lo rota un
     * restablecimiento). Así una sola derivación de la contraseña nueva sirve para
     * compararla contra la actual y contra todo el historial: se pasa de 6 derivaciones
     * a 2, y cambiar la contraseña deja de tardar el triple que un ingreso.
     *
     * El salt sigue siendo único por usuario, que es lo que impide precomputar tablas
     * y comparar hashes entre personas. Compartirlo entre las contraseñas sucesivas de
     * una misma persona solo revela si dos de ellas coinciden, que es justamente lo que
     * aquí queremos detectar.
     */
    var salt = cred.SALT || Cripto_.salt();
    var iter = Number(cred.ITERACIONES) || SEGURIDAD_().ITERACIONES;
    var hashNueva = Cripto_.derivar(claveNueva, salt, iter);

    if (Cripto_.iguales(hashNueva, cred.HASH)) {
      throw new Error('La nueva contraseña debe ser distinta de la actual.');
    }

    for (var i = 0; i < historial.length; i++) {
      var h = historial[i];
      // Formato actual: solo el hash. Formato antiguo: objeto con su propio salt.
      var coincide = (typeof h === 'string')
        ? Cripto_.iguales(hashNueva, h)
        : Cripto_.iguales(Cripto_.derivar(claveNueva, h.salt, h.iter), h.hash);
      if (coincide) {
        throw new Error('No puedes reutilizar tus últimas ' +
                        SEGURIDAD_().HISTORIAL_CLAVES + ' contraseñas.');
      }
    }

    historial.unshift(cred.HASH);
    historial = historial.slice(0, SEGURIDAD_().HISTORIAL_CLAVES);

    Seg_.guardar('CREDENCIAL', cred.IDCREDENCIAL, {
      SALT: salt, ITERACIONES: iter, HASH: hashNueva,
      HISTORIAL: JSON.stringify(historial), DEBE_CAMBIAR: 'NO',
      FECHA_CAMBIO: Utilidades_.ahora(), INTENTOS_FALLIDOS: 0, BLOQUEADO_HASTA: '',
      ESTADO_CREDENCIAL: 'ACTIVA'
    });

    Auditoria_.registrar(ctx, 'CAMBIO_CLAVE', 'CREDENCIAL', cred.IDCREDENCIAL, '', '', '', 'OK',
      'Cambio realizado por el propio usuario');
    return true;
  },

  /** Alta o restablecimiento hecho por el administrador. Devuelve la clave temporal. */
  restablecerClave: function (ctx, idUsuario) {
    Permisos_.exigir(ctx, 'SEGURIDAD', 'ADMINISTRAR');
    var perfil = this.perfilPorIdUsuario(idUsuario);
    if (!perfil) { throw new Error('El usuario no existe.'); }

    var cred = Db_.buscarPor('CREDENCIAL', 'IDUSUARIO', idUsuario);
    var temporal = Politica_.temporal();
    var salt = Cripto_.salt();
    var iter = SEGURIDAD_().ITERACIONES;
    var hash = Cripto_.derivar(temporal, salt, iter);

    if (cred) {
      Seg_.guardar('CREDENCIAL', cred.IDCREDENCIAL, {
        SALT: salt, ITERACIONES: iter, HASH: hash, DEBE_CAMBIAR: 'SI',
        FECHA_CAMBIO: Utilidades_.ahora(), INTENTOS_FALLIDOS: 0, BLOQUEADO_HASTA: '',
        ESTADO_CREDENCIAL: 'ACTIVA'
      });
      Auditoria_.registrar(ctx, 'RESTABLECER_CLAVE', 'CREDENCIAL', cred.IDCREDENCIAL, '', '', '',
        'OK', 'Restablecida para ' + cred.USUARIO_LOGIN);
      this._cerrarSesionesDe(idUsuario, 'Contraseña restablecida');
      return { usuarioLogin: cred.USUARIO_LOGIN, claveTemporal: temporal };
    }

    var login = this._sugerirLogin(perfil);
    var nueva = Seg_.crear('CREDENCIAL', {
      IDUSUARIO: idUsuario, USUARIO_LOGIN: login, HASH: hash, SALT: salt, ITERACIONES: iter,
      HISTORIAL: '[]', DEBE_CAMBIAR: 'SI', FECHA_CAMBIO: Utilidades_.ahora(),
      INTENTOS_FALLIDOS: 0, BLOQUEADO_HASTA: '', ULTIMO_ACCESO: '',
      ESTADO_CREDENCIAL: 'ACTIVA', OBSERVACIONES: 'Creada por ' + ctx.correo
    });
    Auditoria_.registrar(ctx, 'CREAR_CREDENCIAL', 'CREDENCIAL', nueva.IDCREDENCIAL, '', '', '',
      'OK', 'Usuario de acceso: ' + login);
    return { usuarioLogin: login, claveTemporal: temporal };
  },

  _sugerirLogin: function (perfil) {
    var persona = Db_.buscarPorId('PERSONAL', perfil.idPersonal);
    var base = String(persona.NOMBRES || '').trim().split(/\s+/)[0].charAt(0) +
               String(persona.APELLIDOS || '').trim().split(/\s+/)[0];
    base = base.toLowerCase()
      .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
      .replace(/ó/g, 'o').replace(/ú/g, 'u').replace(/ñ/g, 'n')
      .replace(/[^a-z0-9]/g, '');
    var login = base, n = 1;
    while (Db_.buscarPor('CREDENCIAL', 'USUARIO_LOGIN', login)) { login = base + (++n); }
    return login;
  },

  desbloquear: function (ctx, idUsuario) {
    Permisos_.exigir(ctx, 'SEGURIDAD', 'ADMINISTRAR');
    var cred = Db_.buscarPor('CREDENCIAL', 'IDUSUARIO', idUsuario);
    if (!cred) { throw new Error('Ese usuario no tiene credenciales.'); }
    Seg_.guardar('CREDENCIAL', cred.IDCREDENCIAL, {
      INTENTOS_FALLIDOS: 0, BLOQUEADO_HASTA: '', ESTADO_CREDENCIAL: 'ACTIVA'
    });
    Auditoria_.registrar(ctx, 'DESBLOQUEAR', 'CREDENCIAL', cred.IDCREDENCIAL, '',
      'BLOQUEADA', 'ACTIVA', 'OK', 'Usuario ' + cred.USUARIO_LOGIN);
    return true;
  },

  cambiarLogin: function (ctx, idUsuario, nuevoLogin) {
    Permisos_.exigir(ctx, 'SEGURIDAD', 'ADMINISTRAR');
    var login = String(nuevoLogin || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{4,30}$/.test(login)) {
      throw new Error('El usuario de acceso admite de 4 a 30 caracteres: letras, números, punto, guion y guion bajo.');
    }
    var cred = Db_.buscarPor('CREDENCIAL', 'IDUSUARIO', idUsuario);
    if (!cred) { throw new Error('Ese usuario no tiene credenciales.'); }
    var ocupado = Db_.buscarPor('CREDENCIAL', 'USUARIO_LOGIN', login);
    if (ocupado && ocupado.IDCREDENCIAL !== cred.IDCREDENCIAL) {
      throw new Error('Ese usuario de acceso ya está tomado.');
    }
    var antes = cred.USUARIO_LOGIN;
    Seg_.guardar('CREDENCIAL', cred.IDCREDENCIAL, { USUARIO_LOGIN: login });
    Auditoria_.registrar(ctx, 'CAMBIO_LOGIN', 'CREDENCIAL', cred.IDCREDENCIAL, 'USUARIO_LOGIN',
      antes, login, 'OK', '');
    return true;
  },

  estadoCredencial: function (ctx, idUsuario) {
    Permisos_.exigir(ctx, 'SEGURIDAD', 'VER');
    var cred = Db_.buscarPor('CREDENCIAL', 'IDUSUARIO', idUsuario);
    if (!cred) { return { tiene: false }; }
    var sesionesAbiertas = Db_.filtrar('SESION', function (s) {
      return s.IDUSUARIO === idUsuario && String(s.ESTADO_SESION).toUpperCase() === 'ABIERTA';
    }).length;
    return {
      tiene: true,
      usuarioLogin: cred.USUARIO_LOGIN,
      estado: cred.ESTADO_CREDENCIAL,
      debeCambiar: cred.DEBE_CAMBIAR,
      ultimoAcceso: cred.ULTIMO_ACCESO,
      fechaCambio: cred.FECHA_CAMBIO,
      intentosFallidos: cred.INTENTOS_FALLIDOS,
      bloqueadoHasta: cred.BLOQUEADO_HASTA,
      sesionesAbiertas: sesionesAbiertas
    };
  },

  cerrarSesionesDe: function (ctx, idUsuario) {
    Permisos_.exigir(ctx, 'SEGURIDAD', 'ADMINISTRAR');
    var n = this._cerrarSesionesDe(idUsuario, 'Cierre forzado por ' + ctx.correo);
    Auditoria_.registrar(ctx, 'CERRAR_SESIONES', 'SESION', idUsuario, '', '', '', 'OK',
      'Sesiones cerradas: ' + n);
    return { cerradas: n };
  },

  _cerrarSesionesDe: function (idUsuario, motivo) {
    var n = 0;
    Db_.leer('SESION').forEach(function (s) {
      if (s.IDUSUARIO !== idUsuario || String(s.ESTADO_SESION).toUpperCase() !== 'ABIERTA') { return; }
      Seg_.guardar('SESION', s.IDSESION, {
        ESTADO_SESION: 'CERRADA', FECHA_CIERRE: Utilidades_.ahora(), OBSERVACIONES: motivo
      });
      n++;
    });
    return n;
  },

  /* ---------- Atajos usados por el resto de módulos ---------- */

  exigirLectura: function (ctx, tabla) {
    Permisos_.exigirTabla(ctx, tabla, 'VER');
  },

  exigirEscritura: function (ctx, tabla) {
    Permisos_.exigirTabla(ctx, tabla, 'EDITAR');
  },

  puedeLeer: function (ctx, tabla) {
    return Permisos_.puedeTabla(ctx, tabla, 'VER');
  },

  puedeEscribir: function (ctx, tabla) {
    return Permisos_.puedeTabla(ctx, tabla, 'EDITAR');
  },

  exigirPublicacion: function (ctx) {
    Permisos_.exigir(ctx, 'CALENDARIO', 'PUBLICAR');
  },

  _publico: function (perfil) {
    return {
      nombre: perfil.nombre, correo: perfil.correo, nivel: perfil.nivel,
      etiquetaNivel: perfil.etiquetaNivel
    };
  }
};

/** Trigger diario opcional: marca como expiradas las sesiones vencidas. */
function limpiarSesiones() {
  var ahora = Utilidades_.ahora();
  var n = 0;
  Db_.leer('SESION').forEach(function (s) {
    if (String(s.ESTADO_SESION).toUpperCase() !== 'ABIERTA') { return; }
    if (String(s.FECHA_EXPIRA) >= ahora) { return; }
    Seg_.guardar('SESION', s.IDSESION, { ESTADO_SESION: 'EXPIRADA', FECHA_CIERRE: ahora });
    n++;
  });
  return n;
}

/**
 * Calibración. Ejecútala desde el editor para saber cuánto cuesta realmente el
 * hash en TU proyecto: el tiempo depende del entorno de Apps Script, no del código.
 *
 * Lee el resultado en el registro de ejecución y ajusta SEGURIDAD_().ITERACIONES:
 * un ingreso debería tardar entre 1 y 2 segundos. Más que eso frustra al usuario;
 * mucho menos, debilita la protección del hash.
 */
function medirCostoHash() {
  var salt = Cripto_.salt();
  var iter = SEGURIDAD_().ITERACIONES;

  var t0 = new Date().getTime();
  Cripto_.derivar('ContrasenaDePrueba123', salt, iter);
  var unaDerivacion = new Date().getTime() - t0;

  var texto =
    'Iteraciones configuradas: ' + iter + '\n' +
    'Una derivación: ' + unaDerivacion + ' ms\n' +
    '\n' +
    'Coste estimado por operación:\n' +
    '  · Ingresar (1 derivación):        ' + unaDerivacion + ' ms\n' +
    '  · Cambiar contraseña (' + (SEGURIDAD_().HISTORIAL_CLAVES + 2) + ' derivaciones): ' +
        (unaDerivacion * (SEGURIDAD_().HISTORIAL_CLAVES + 2)) + ' ms\n' +
    '\n' +
    'Si el ingreso supera los 2000 ms, baja ITERACIONES en 01_Config.gs.\n' +
    'Para apuntar a 1500 ms por ingreso, usa aproximadamente: ' +
        Math.max(200, Math.round(iter * 1500 / Math.max(unaDerivacion, 1))) + ' iteraciones.';

  console.log(texto);
  try {
    SpreadsheetApp.getUi().alert('Coste del hash', texto, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (ignore) { /* ejecutado desde el editor */ }
  return texto;
}
