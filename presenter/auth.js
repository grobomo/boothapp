/**
 * BoothApp Authentication Module
 *
 * Stores users in S3 (auth/users.json). Passwords hashed with SHA-256 + random salt.
 * Sessions stored in localStorage. All dashboard pages include this and call
 * BoothAuth.requireLogin() to gate content behind auth.
 */
var BoothAuth = (function () {
  var BUCKET = "boothapp-sessions-752266476357";
  var REGION = "us-east-1";
  var AUTH_KEY = "auth/users.json";
  var LS_SESSION = "boothapp_session";
  var LS_KEY_AK = "boothapp_aws_ak";
  var LS_KEY_SK = "boothapp_aws_sk";

  var s3 = null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function hexEncode(buf) {
    return Array.from(new Uint8Array(buf))
      .map(function (b) { return b.toString(16).padStart(2, "0"); })
      .join("");
  }

  function randomSalt() {
    var arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return hexEncode(arr);
  }

  function hashPassword(password, salt) {
    var data = new TextEncoder().encode(salt + ":" + password);
    return crypto.subtle.digest("SHA-256", data).then(function (buf) {
      return hexEncode(buf);
    });
  }

  function generateToken() {
    var arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return hexEncode(arr);
  }

  // ── S3 access ─────────────────────────────────────────────────────────────

  function getS3() {
    if (s3) return s3;
    var ak = localStorage.getItem(LS_KEY_AK);
    var sk = localStorage.getItem(LS_KEY_SK);
    if (!ak || !sk) return null;
    AWS.config.update({ accessKeyId: ak, secretAccessKey: sk, region: REGION });
    s3 = new AWS.S3({ params: { Bucket: BUCKET } });
    return s3;
  }

  function loadUsers() {
    return new Promise(function (resolve, reject) {
      var client = getS3();
      if (!client) { reject(new Error("No AWS credentials configured")); return; }
      client.getObject({ Key: AUTH_KEY }, function (err, data) {
        if (err) {
          if (err.code === "NoSuchKey" || err.code === "AccessDenied") {
            resolve(null); // no users file yet
          } else {
            reject(err);
          }
          return;
        }
        try {
          resolve(JSON.parse(data.Body.toString()));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  function saveUsers(usersObj) {
    return new Promise(function (resolve, reject) {
      var client = getS3();
      if (!client) { reject(new Error("No AWS credentials configured")); return; }
      client.putObject({
        Key: AUTH_KEY,
        Body: JSON.stringify(usersObj, null, 2),
        ContentType: "application/json"
      }, function (err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // ── Default admin bootstrap ───────────────────────────────────────────────

  function bootstrapDefaultAdmin() {
    var salt = randomSalt();
    return hashPassword("admin", salt).then(function (hash) {
      var users = {
        version: 1,
        users: [
          {
            username: "admin",
            password_hash: hash,
            salt: salt,
            role: "admin",
            force_password_change: true,
            created_at: new Date().toISOString()
          }
        ]
      };
      return saveUsers(users).then(function () { return users; });
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function getSession() {
    try {
      var raw = localStorage.getItem(LS_SESSION);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function setSession(session) {
    localStorage.setItem(LS_SESSION, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(LS_SESSION);
  }

  /**
   * Authenticate user. Returns { success, user, error }.
   */
  function login(username, password) {
    return loadUsers().then(function (data) {
      if (!data) {
        // First run — create default admin
        return bootstrapDefaultAdmin().then(function (freshData) {
          return doLogin(freshData, username, password);
        });
      }
      return doLogin(data, username, password);
    });
  }

  function doLogin(data, username, password) {
    var user = null;
    for (var i = 0; i < data.users.length; i++) {
      if (data.users[i].username === username) {
        user = data.users[i];
        break;
      }
    }
    if (!user) {
      return Promise.resolve({ success: false, error: "Invalid username or password" });
    }
    return hashPassword(password, user.salt).then(function (hash) {
      if (hash !== user.password_hash) {
        return { success: false, error: "Invalid username or password" };
      }
      var token = generateToken();
      var session = {
        username: user.username,
        role: user.role,
        token: token,
        force_password_change: !!user.force_password_change,
        logged_in_at: new Date().toISOString()
      };
      setSession(session);
      return { success: true, user: session };
    });
  }

  /**
   * Change password for the current user.
   */
  function changePassword(username, newPassword) {
    return loadUsers().then(function (data) {
      if (!data) return Promise.reject(new Error("No users database"));
      var user = null;
      for (var i = 0; i < data.users.length; i++) {
        if (data.users[i].username === username) {
          user = data.users[i];
          break;
        }
      }
      if (!user) return Promise.reject(new Error("User not found"));
      var salt = randomSalt();
      return hashPassword(newPassword, salt).then(function (hash) {
        user.password_hash = hash;
        user.salt = salt;
        user.force_password_change = false;
        user.password_changed_at = new Date().toISOString();
        return saveUsers(data);
      });
    }).then(function () {
      // Update session to clear force flag
      var session = getSession();
      if (session && session.username === username) {
        session.force_password_change = false;
        setSession(session);
      }
    });
  }

  /**
   * Admin: add a new user.
   */
  function addUser(username, password, role) {
    role = role || "viewer";
    return loadUsers().then(function (data) {
      if (!data) return Promise.reject(new Error("No users database"));
      // Check duplicate
      for (var i = 0; i < data.users.length; i++) {
        if (data.users[i].username === username) {
          return Promise.reject(new Error("User already exists"));
        }
      }
      var salt = randomSalt();
      return hashPassword(password, salt).then(function (hash) {
        data.users.push({
          username: username,
          password_hash: hash,
          salt: salt,
          role: role,
          force_password_change: true,
          created_at: new Date().toISOString()
        });
        return saveUsers(data);
      });
    });
  }

  /**
   * Admin: force password reset for a user.
   */
  function forcePasswordReset(username) {
    return loadUsers().then(function (data) {
      if (!data) return Promise.reject(new Error("No users database"));
      var found = false;
      for (var i = 0; i < data.users.length; i++) {
        if (data.users[i].username === username) {
          data.users[i].force_password_change = true;
          found = true;
          break;
        }
      }
      if (!found) return Promise.reject(new Error("User not found"));
      return saveUsers(data);
    });
  }

  /**
   * Admin: delete a user.
   */
  function deleteUser(username) {
    return loadUsers().then(function (data) {
      if (!data) return Promise.reject(new Error("No users database"));
      var idx = -1;
      for (var i = 0; i < data.users.length; i++) {
        if (data.users[i].username === username) { idx = i; break; }
      }
      if (idx === -1) return Promise.reject(new Error("User not found"));
      if (data.users[idx].role === "admin") {
        // Don't allow deleting the last admin
        var adminCount = data.users.filter(function (u) { return u.role === "admin"; }).length;
        if (adminCount <= 1) return Promise.reject(new Error("Cannot delete the last admin"));
      }
      data.users.splice(idx, 1);
      return saveUsers(data);
    });
  }

  /**
   * Admin: list all users (no passwords).
   */
  function listUsers() {
    return loadUsers().then(function (data) {
      if (!data) return [];
      return data.users.map(function (u) {
        return {
          username: u.username,
          role: u.role,
          force_password_change: !!u.force_password_change,
          created_at: u.created_at || "",
          password_changed_at: u.password_changed_at || ""
        };
      });
    });
  }

  /**
   * Check if current session is valid and redirect to login if not.
   * Call this at the top of every protected page.
   * Requires AWS SDK to be loaded first.
   */
  function requireLogin() {
    var session = getSession();
    if (!session) {
      window.location.href = "login.html?redirect=" + encodeURIComponent(window.location.href);
      return false;
    }
    if (session.force_password_change) {
      window.location.href = "login.html?change_password=1";
      return false;
    }
    return true;
  }

  /**
   * Check if AWS credentials are configured. If not, redirect to sessions.html
   * which has the AWS credential setup form.
   */
  function requireAwsCreds() {
    var ak = localStorage.getItem(LS_KEY_AK);
    var sk = localStorage.getItem(LS_KEY_SK);
    return !!(ak && sk);
  }

  function logout() {
    clearSession();
    window.location.href = "login.html";
  }

  function isAdmin() {
    var session = getSession();
    return session && session.role === "admin";
  }

  function currentUser() {
    var session = getSession();
    return session ? session.username : null;
  }

  return {
    getSession: getSession,
    login: login,
    logout: logout,
    changePassword: changePassword,
    addUser: addUser,
    deleteUser: deleteUser,
    forcePasswordReset: forcePasswordReset,
    listUsers: listUsers,
    requireLogin: requireLogin,
    requireAwsCreds: requireAwsCreds,
    isAdmin: isAdmin,
    currentUser: currentUser
  };
})();
