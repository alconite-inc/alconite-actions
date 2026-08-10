"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/ignore/index.js
var require_ignore = __commonJS({
  "node_modules/ignore/index.js"(exports2, module2) {
    function makeArray(subject) {
      return Array.isArray(subject) ? subject : [subject];
    }
    var UNDEFINED = void 0;
    var EMPTY = "";
    var SPACE = " ";
    var ESCAPE = "\\";
    var REGEX_TEST_BLANK_LINE = /^\s+$/;
    var REGEX_INVALID_TRAILING_BACKSLASH = /(?:[^\\]|^)\\$/;
    var REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION = /^\\!/;
    var REGEX_REPLACE_LEADING_EXCAPED_HASH = /^\\#/;
    var REGEX_SPLITALL_CRLF = /\r?\n/g;
    var REGEX_TEST_INVALID_PATH = /^\.{0,2}\/|^\.{1,2}$/;
    var REGEX_TEST_TRAILING_SLASH = /\/$/;
    var SLASH = "/";
    var TMP_KEY_IGNORE = "node-ignore";
    if (typeof Symbol !== "undefined") {
      TMP_KEY_IGNORE = /* @__PURE__ */ Symbol.for("node-ignore");
    }
    var KEY_IGNORE = TMP_KEY_IGNORE;
    var define = (object, key, value) => {
      Object.defineProperty(object, key, { value });
      return value;
    };
    var REGEX_REGEXP_RANGE = /([0-z])-([0-z])/g;
    var RETURN_FALSE = () => false;
    var sanitizeRange = (range) => range.replace(
      REGEX_REGEXP_RANGE,
      (match, from, to) => from.charCodeAt(0) <= to.charCodeAt(0) ? match : EMPTY
    );
    var negateRange = (range) => range.startsWith("!") || range.startsWith("\\^") ? `^${range.slice(range[0] === "!" ? 1 : 2)}` : range;
    var cleanRangeBackSlash = (slashes) => {
      const { length } = slashes;
      return slashes.slice(0, length - length % 2);
    };
    var REPLACERS = [
      [
        // Remove BOM
        // TODO:
        // Other similar zero-width characters?
        /^\uFEFF/,
        () => EMPTY
      ],
      // > Trailing spaces are ignored unless they are quoted with backslash ("\")
      [
        // (a\ ) -> (a )
        // (a  ) -> (a)
        // (a ) -> (a)
        // (a \ ) -> (a  )
        /((?:\\\\)*?)(\\?\s+)$/,
        (_, m1, m2) => m1 + (m2.indexOf("\\") === 0 ? SPACE : EMPTY)
      ],
      // Replace (\ ) with ' '
      // (\ ) -> ' '
      // (\\ ) -> '\\ '
      // (\\\ ) -> '\\ '
      [
        /(\\+?)\s/g,
        (_, m1) => {
          const { length } = m1;
          return m1.slice(0, length - length % 2) + SPACE;
        }
      ],
      // Escape metacharacters
      // which is written down by users but means special for regular expressions.
      // > There are 12 characters with special meanings:
      // > - the backslash \,
      // > - the caret ^,
      // > - the dollar sign $,
      // > - the period or dot .,
      // > - the vertical bar or pipe symbol |,
      // > - the question mark ?,
      // > - the asterisk or star *,
      // > - the plus sign +,
      // > - the opening parenthesis (,
      // > - the closing parenthesis ),
      // > - and the opening square bracket [,
      // > - the opening curly brace {,
      // > These special characters are often called "metacharacters".
      [
        /[\\$.|*+(){^]/g,
        (match) => `\\${match}`
      ],
      [
        // > a question mark (?) matches a single character
        /(?!\\)\?/g,
        () => "[^/]"
      ],
      // leading slash
      [
        // > A leading slash matches the beginning of the pathname.
        // > For example, "/*.c" matches "cat-file.c" but not "mozilla-sha1/sha1.c".
        // A leading slash matches the beginning of the pathname
        /^\//,
        () => "^"
      ],
      // replace special metacharacter slash after the leading slash
      [
        /\//g,
        () => "\\/"
      ],
      [
        // > A leading "**" followed by a slash means match in all directories.
        // > For example, "**/foo" matches file or directory "foo" anywhere,
        // > the same as pattern "foo".
        // > "**/foo/bar" matches file or directory "bar" anywhere that is directly
        // >   under directory "foo".
        // Notice that the '*'s have been replaced as '\\*'
        /^\^*(?:\\\*\\\*\\\/)+/,
        // '**/foo' <-> 'foo'
        () => "^(?:.*\\/)?"
      ],
      // starting
      [
        // there will be no leading '/'
        //   (which has been replaced by section "leading slash")
        // If starts with '**', adding a '^' to the regular expression also works
        /^(?=[^^])/,
        function startingReplacer() {
          return !/\/(?!$)/.test(this) ? "(?:^|\\/)" : "^";
        }
      ],
      // two globstars
      [
        // Use lookahead assertions so that we could match more than one `'/**'`
        /\\\/\\\*\\\*(?=\\\/|$)/g,
        // Zero, one or several directories
        // should not use '*', or it will be replaced by the next replacer
        // Check if it is not the last `'/**'`
        (_, index, str) => index + 6 < str.length ? "(?:\\/[^\\/]+)*" : "\\/.+"
      ],
      // normal intermediate wildcards
      [
        // Never replace escaped '*'
        // ignore rule '\*' will match the path '*'
        // 'abc.*/' -> go
        // 'abc.*'  -> skip this rule,
        //    coz trailing single wildcard will be handed by [trailing wildcard]
        /(^|[^\\]+)(\\\*)+(?=.+)/g,
        // '*.js' matches '.js'
        // '*.js' doesn't match 'abc'
        (_, p1, p2) => {
          const unescaped = p2.replace(/\\\*/g, "[^\\/]*");
          return p1 + unescaped;
        }
      ],
      [
        // unescape, revert step 3 except for back slash
        // For example, if a user escape a '\\*',
        // after step 3, the result will be '\\\\\\*'
        /\\\\\\(?=[$.|*+(){^])/g,
        () => ESCAPE
      ],
      [
        // '\\\\' -> '\\'
        /\\\\/g,
        () => ESCAPE
      ],
      [
        // > The range notation, e.g. [a-zA-Z],
        // > can be used to match one of the characters in a range.
        // `\` is escaped by step 3
        /(\\)?\[([^\]/]*?)(\\*)($|\])/g,
        (match, leadEscape, range, endEscape, close) => leadEscape === ESCAPE ? `\\[${range}${cleanRangeBackSlash(endEscape)}${close}` : close === "]" ? endEscape.length % 2 === 0 ? `[${negateRange(sanitizeRange(range))}${endEscape}]` : "[]" : "[]"
      ],
      // ending
      [
        // 'js' will not match 'js.'
        // 'ab' will not match 'abc'
        /(?:[^*])$/,
        // WTF!
        // https://git-scm.com/docs/gitignore
        // changes in [2.22.1](https://git-scm.com/docs/gitignore/2.22.1)
        // which re-fixes #24, #38
        // > If there is a separator at the end of the pattern then the pattern
        // > will only match directories, otherwise the pattern can match both
        // > files and directories.
        // 'js*' will not match 'a.js'
        // 'js/' will not match 'a.js'
        // 'js' will match 'a.js' and 'a.js/'
        (match) => /\/$/.test(match) ? `${match}$` : `${match}(?=$|\\/$)`
      ]
    ];
    var REGEX_REPLACE_TRAILING_WILDCARD = /(^|\\\/)?\\\*$/;
    var MODE_IGNORE = "regex";
    var MODE_CHECK_IGNORE = "checkRegex";
    var UNDERSCORE = "_";
    var TRAILING_WILD_CARD_REPLACERS = {
      [MODE_IGNORE](_, p1) {
        const prefix = p1 ? `${p1}[^/]+` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      },
      [MODE_CHECK_IGNORE](_, p1) {
        const prefix = p1 ? `${p1}[^/]*` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      }
    };
    var makeRegexPrefix = (pattern) => REPLACERS.reduce(
      (prev, [matcher, replacer]) => prev.replace(matcher, replacer.bind(pattern)),
      pattern
    );
    var isString = (subject) => typeof subject === "string";
    var checkPattern = (pattern) => pattern && isString(pattern) && !REGEX_TEST_BLANK_LINE.test(pattern) && !REGEX_INVALID_TRAILING_BACKSLASH.test(pattern) && pattern.indexOf("#") !== 0;
    var splitPattern = (pattern) => pattern.split(REGEX_SPLITALL_CRLF).filter(Boolean);
    var IgnoreRule = class {
      constructor(pattern, mark, body, ignoreCase, negative, prefix) {
        this.pattern = pattern;
        this.mark = mark;
        this.negative = negative;
        define(this, "body", body);
        define(this, "ignoreCase", ignoreCase);
        define(this, "regexPrefix", prefix);
      }
      get regex() {
        const key = UNDERSCORE + MODE_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_IGNORE, key);
      }
      get checkRegex() {
        const key = UNDERSCORE + MODE_CHECK_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_CHECK_IGNORE, key);
      }
      _make(mode, key) {
        const str = this.regexPrefix.replace(
          REGEX_REPLACE_TRAILING_WILDCARD,
          // It does not need to bind pattern
          TRAILING_WILD_CARD_REPLACERS[mode]
        );
        const regex = this.ignoreCase ? new RegExp(str, "i") : new RegExp(str);
        return define(this, key, regex);
      }
    };
    var createRule = ({
      pattern,
      mark
    }, ignoreCase) => {
      let negative = false;
      let body = pattern;
      if (body.indexOf("!") === 0) {
        negative = true;
        body = body.substr(1);
      }
      body = body.replace(REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION, "!").replace(REGEX_REPLACE_LEADING_EXCAPED_HASH, "#");
      const regexPrefix = makeRegexPrefix(body);
      return new IgnoreRule(
        pattern,
        mark,
        body,
        ignoreCase,
        negative,
        regexPrefix
      );
    };
    var RuleManager = class {
      constructor(ignoreCase) {
        this._ignoreCase = ignoreCase;
        this._rules = [];
      }
      _add(pattern) {
        if (pattern && pattern[KEY_IGNORE]) {
          this._rules = this._rules.concat(pattern._rules._rules);
          this._added = true;
          return;
        }
        if (isString(pattern)) {
          pattern = {
            pattern
          };
        }
        if (checkPattern(pattern.pattern)) {
          const rule = createRule(pattern, this._ignoreCase);
          this._added = true;
          this._rules.push(rule);
        }
      }
      // @param {Array<string> | string | Ignore} pattern
      add(pattern) {
        this._added = false;
        makeArray(
          isString(pattern) ? splitPattern(pattern) : pattern
        ).forEach(this._add, this);
        return this._added;
      }
      // Test one single path without recursively checking parent directories
      //
      // - checkUnignored `boolean` whether should check if the path is unignored,
      //   setting `checkUnignored` to `false` could reduce additional
      //   path matching.
      // - check `string` either `MODE_IGNORE` or `MODE_CHECK_IGNORE`
      // @returns {TestResult} true if a file is ignored
      test(path4, checkUnignored, mode) {
        let ignored = false;
        let unignored = false;
        let matchedRule;
        this._rules.forEach((rule) => {
          const { negative } = rule;
          if (unignored === negative && ignored !== unignored || negative && !ignored && !unignored && !checkUnignored) {
            return;
          }
          const matched = rule[mode].test(path4);
          if (!matched) {
            return;
          }
          ignored = !negative;
          unignored = negative;
          matchedRule = negative ? UNDEFINED : rule;
        });
        const ret = {
          ignored,
          unignored
        };
        if (matchedRule) {
          ret.rule = matchedRule;
        }
        return ret;
      }
    };
    var throwError = (message, Ctor) => {
      throw new Ctor(message);
    };
    var checkPath = (path4, originalPath, doThrow) => {
      if (!isString(path4)) {
        return doThrow(
          `path must be a string, but got \`${originalPath}\``,
          TypeError
        );
      }
      if (!path4) {
        return doThrow(`path must not be empty`, TypeError);
      }
      if (checkPath.isNotRelative(path4)) {
        const r = "`path.relative()`d";
        return doThrow(
          `path should be a ${r} string, but got "${originalPath}"`,
          RangeError
        );
      }
      return true;
    };
    var isNotRelative = (path4) => REGEX_TEST_INVALID_PATH.test(path4);
    checkPath.isNotRelative = isNotRelative;
    checkPath.convert = (p) => p;
    var Ignore = class {
      constructor({
        ignorecase = true,
        ignoreCase = ignorecase,
        allowRelativePaths = false
      } = {}) {
        define(this, KEY_IGNORE, true);
        this._rules = new RuleManager(ignoreCase);
        this._strictPathCheck = !allowRelativePaths;
        this._initCache();
      }
      _initCache() {
        this._ignoreCache = /* @__PURE__ */ Object.create(null);
        this._testCache = /* @__PURE__ */ Object.create(null);
      }
      add(pattern) {
        if (this._rules.add(pattern)) {
          this._initCache();
        }
        return this;
      }
      // legacy
      addPattern(pattern) {
        return this.add(pattern);
      }
      // @returns {TestResult}
      _test(originalPath, cache, checkUnignored, slices) {
        const path4 = originalPath && checkPath.convert(originalPath);
        checkPath(
          path4,
          originalPath,
          this._strictPathCheck ? throwError : RETURN_FALSE
        );
        return this._t(path4, cache, checkUnignored, slices);
      }
      checkIgnore(path4) {
        if (!REGEX_TEST_TRAILING_SLASH.test(path4)) {
          return this.test(path4);
        }
        const slices = path4.split(SLASH).filter(Boolean);
        slices.pop();
        if (slices.length) {
          const parent = this._t(
            slices.join(SLASH) + SLASH,
            this._testCache,
            true,
            slices
          );
          if (parent.ignored) {
            return parent;
          }
        }
        return this._rules.test(path4, false, MODE_CHECK_IGNORE);
      }
      _t(path4, cache, checkUnignored, slices) {
        if (path4 in cache) {
          return cache[path4];
        }
        if (!slices) {
          slices = path4.split(SLASH).filter(Boolean);
        }
        slices.pop();
        if (!slices.length) {
          return cache[path4] = this._rules.test(path4, checkUnignored, MODE_IGNORE);
        }
        const parent = this._t(
          slices.join(SLASH) + SLASH,
          cache,
          checkUnignored,
          slices
        );
        return cache[path4] = parent.ignored ? parent : this._rules.test(path4, checkUnignored, MODE_IGNORE);
      }
      ignores(path4) {
        return this._test(path4, this._ignoreCache, false).ignored;
      }
      createFilter() {
        return (path4) => !this.ignores(path4);
      }
      filter(paths) {
        return makeArray(paths).filter(this.createFilter());
      }
      // @returns {TestResult}
      test(path4) {
        return this._test(path4, this._testCache, true);
      }
    };
    var factory = (options) => new Ignore(options);
    var isPathValid = (path4) => checkPath(path4 && checkPath.convert(path4), path4, RETURN_FALSE);
    var setupWindows = () => {
      const makePosix = (str) => /^\\\\\?\\/.test(str) || /["<>|\u0000-\u001F]+/u.test(str) ? str : str.replace(/\\/g, "/");
      checkPath.convert = makePosix;
      const REGEX_TEST_WINDOWS_PATH_ABSOLUTE = /^[a-z]:\//i;
      checkPath.isNotRelative = (path4) => REGEX_TEST_WINDOWS_PATH_ABSOLUTE.test(path4) || isNotRelative(path4);
    };
    if (
      // Detect `process` so that it can run in browsers.
      typeof process !== "undefined" && process.platform === "win32"
    ) {
      setupWindows();
    }
    module2.exports = factory;
    factory.default = factory;
    module2.exports.isPathValid = isPathValid;
    define(module2.exports, /* @__PURE__ */ Symbol.for("setupWindows"), setupWindows);
  }
});

// src/github.ts
var import_node_fs = require("node:fs");
var import_node_crypto = require("node:crypto");
function commandEscape(value) {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}
function propertyEscape(value) {
  return commandEscape(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}
function command(name, message, properties = {}) {
  const serialized = Object.entries(properties).map(([key, value]) => `${key}=${propertyEscape(value)}`).join(",");
  process.stdout.write(`::${name}${serialized ? ` ${serialized}` : ""}::${commandEscape(message)}
`);
}
function getInput(name, options = {}) {
  const key = `INPUT_${name.replaceAll(" ", "_").toUpperCase()}`;
  const value = (process.env[key] || "").trim();
  if (options.required && !value) throw new Error(`Input required and not supplied: ${name}`);
  return value;
}
function setSecret(value) {
  if (value) command("add-mask", value);
}
function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    command("set-output", value, { name });
    return;
  }
  const delimiter = `ghadelimiter_${(0, import_node_crypto.randomUUID)()}`;
  (0, import_node_fs.appendFileSync)(outputFile, `${name}<<${delimiter}
${value}
${delimiter}
`, { encoding: "utf8" });
}
function info(message) {
  process.stdout.write(`${message}
`);
}
function error(message, title) {
  command("error", message, title ? { title } : {});
}
function setFailed(message) {
  error(message);
  process.exitCode = 1;
}
function markdownCell(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("|", "\\|").replaceAll("\r", " ").replaceAll("\n", "<br>");
}
function markdownTable(headers, rows) {
  return [
    `| ${headers.map(markdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`)
  ].join("\n");
}
function writeJobSummary(markdown) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) (0, import_node_fs.appendFileSync)(summaryFile, markdown, { encoding: "utf8" });
}

// src/impact/deadline.ts
var import_node_perf_hooks = require("node:perf_hooks");

// src/impact/errors.ts
var ImpactActionError = class extends Error {
  code;
  status;
  platformCode;
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "ImpactActionError";
    this.code = code;
    this.status = options.status;
    this.platformCode = options.platformCode;
  }
};

// src/impact/deadline.ts
var defaultDependencies = {
  now: () => import_node_perf_hooks.performance.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
};
var ActionDeadline = class {
  constructor(timeoutMilliseconds, dependencies = defaultDependencies) {
    this.dependencies = dependencies;
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 6e5) {
      throw new ImpactActionError("invalid_input", "timeout-seconds must be an integer from 1 through 600");
    }
    this.expiresAt = dependencies.now() + timeoutMilliseconds;
  }
  dependencies;
  expiresAt;
  remainingMilliseconds() {
    return Math.max(0, Math.floor(this.expiresAt - this.dependencies.now()));
  }
  throwIfExpired() {
    if (this.remainingMilliseconds() <= 0) {
      throw new ImpactActionError("action_deadline_exceeded", "Alconite Impact exceeded the overall Action deadline.");
    }
  }
  signal() {
    this.throwIfExpired();
    return AbortSignal.timeout(Math.max(1, this.remainingMilliseconds()));
  }
  async wait(milliseconds) {
    this.throwIfExpired();
    const remaining = this.remainingMilliseconds();
    if (milliseconds >= remaining) {
      throw new ImpactActionError("action_deadline_exceeded", "Alconite Impact exhausted its deadline before another retry.");
    }
    await this.dependencies.sleep(milliseconds);
    this.throwIfExpired();
  }
};

// src/impact/models.ts
var IMPACT_REPORT_SCHEMA_VERSION = "alconite.impact.report.v1";
var CLIENT_COLLECTION_SCHEMA_VERSION = "alconite.impact.client-collection.v1";
var MAX_REPORT_BYTES = 8 * 1024 * 1024;
var RISK_VALUES = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
var CONFIDENCE_VALUES = ["LOW", "MEDIUM", "HIGH"];
var SOURCE_LANGUAGES = ["RUST", "JAVA", "TYPESCRIPT", "JAVASCRIPT"];
var SKIP_CODES = [
  "FIXED_IGNORE",
  "GITIGNORE",
  "ADDITIONAL_IGNORE",
  "UNSUPPORTED_FILE",
  "BINARY_FILE",
  "INVALID_UTF8",
  "FILE_TOO_LARGE",
  "SYMLINK_OR_REPARSE",
  "PATH_TOO_LONG",
  "DEPTH_EXCEEDED"
];
var EVIDENCE_TYPES = [
  "OPERATION_ID",
  "ENDPOINT_PATH",
  "SCHEMA_NAME",
  "PROPERTY_REFERENCE",
  "PARAMETER_REFERENCE",
  "SERDE_RENAME",
  "JACKSON_PROPERTY",
  "TYPE_REFERENCE",
  "CLIENT_METHOD",
  "HTTP_CALL",
  "ENUM_REFERENCE"
];
var CONFIDENCE_CONDITIONS = [
  "METHOD_PATH_CALL",
  "MATCHING_TYPE_MEMBER",
  "OWNED_ENUM",
  "OWNED_PARAMETER",
  "OPERATION_PATH_CALL",
  "QUALIFIED_MEMBER",
  "EXACT_CLIENT_METHOD",
  "EXACT_TYPE",
  "UNIQUE_UNQUALIFIED_PROPERTY",
  "ISOLATED_PATH",
  "ISOLATED_SCHEMA"
];
var WARNING_CODES = [
  "BINARY_FILE_SKIPPED",
  "INVALID_UTF8_SKIPPED",
  "FILE_TOO_LARGE_SKIPPED",
  "PATH_TOO_LONG_SKIPPED",
  "DEPTH_EXCEEDED",
  "SYMLINK_SKIPPED",
  "FILE_READ_FAILED",
  "MALFORMED_SOURCE",
  "EVIDENCE_TRUNCATED",
  "AFFECTED_SOURCES_TRUNCATED",
  "REPORT_TRUNCATED",
  "WARNINGS_TRUNCATED"
];
var CHANGE_KINDS = [
  "ENDPOINT_ADDED",
  "ENDPOINT_REMOVED",
  "HTTP_METHOD_ADDED",
  "HTTP_METHOD_REMOVED",
  "PARAMETER_ADDED",
  "REQUIRED_PARAMETER_ADDED",
  "PARAMETER_REMOVED",
  "PARAMETER_TYPE_CHANGED",
  "PARAMETER_REQUIREMENT_CHANGED",
  "PARAMETER_CONSTRAINT_CHANGED",
  "PARAMETER_ENUM_VALUE_ADDED",
  "PARAMETER_ENUM_VALUE_REMOVED",
  "REQUEST_BODY_ADDED",
  "REQUIRED_REQUEST_BODY_ADDED",
  "REQUEST_BODY_REMOVED",
  "REQUEST_BODY_REQUIREMENT_CHANGED",
  "REQUEST_SCHEMA_CHANGED",
  "REQUEST_MEDIA_TYPE_ADDED",
  "REQUEST_MEDIA_TYPE_REMOVED",
  "RESPONSE_ADDED",
  "RESPONSE_REMOVED",
  "RESPONSE_SCHEMA_CHANGED",
  "RESPONSE_MEDIA_TYPE_ADDED",
  "RESPONSE_MEDIA_TYPE_REMOVED",
  "SCHEMA_ADDED",
  "SCHEMA_REMOVED",
  "PROPERTY_ADDED",
  "PROPERTY_REMOVED",
  "PROPERTY_TYPE_CHANGED",
  "PROPERTY_REQUIREMENT_CHANGED",
  "PROPERTY_CONSTRAINT_CHANGED",
  "REQUIRED_REQUEST_PROPERTY_ADDED",
  "ENUM_VALUE_ADDED",
  "ENUM_VALUE_REMOVED",
  "OPERATION_ID_CHANGED",
  "DEPRECATION_CHANGED",
  "SECURITY_REQUIREMENT_STRENGTHENED",
  "SECURITY_REQUIREMENT_WEAKENED",
  "SECURITY_SCHEME_ADDED",
  "SECURITY_SCHEME_REMOVED",
  "SECURITY_SCOPE_ADDED",
  "SECURITY_SCOPE_REMOVED",
  "SERVER_ADDED",
  "SERVER_REMOVED",
  "METADATA_CHANGED",
  "ANALYZER_REGRESSION",
  "ANALYZER_RESOLUTION"
];
var ImpactContractError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ImpactContractError";
  }
};
var HTTP_METHODS = /* @__PURE__ */ new Set(["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"]);
var CLASSIFICATIONS = /* @__PURE__ */ new Set(["breaking", "risky", "non_breaking", "informational"]);
var CATEGORIES = /* @__PURE__ */ new Set([
  "operation",
  "parameter",
  "request_body",
  "response",
  "schema",
  "security",
  "server",
  "media_type",
  "metadata",
  "analyzer_regression",
  "analyzer_resolution"
]);
var RISK_SET = new Set(RISK_VALUES);
var CONFIDENCE_SET = new Set(CONFIDENCE_VALUES);
var LANGUAGE_SET = new Set(SOURCE_LANGUAGES);
var EVIDENCE_SET = new Set(EVIDENCE_TYPES);
var CONDITION_SET = new Set(CONFIDENCE_CONDITIONS);
var WARNING_SET = new Set(WARNING_CODES);
var CHANGE_KIND_SET = new Set(CHANGE_KINDS);
var SKIP_CODE_SET = new Set(SKIP_CODES);
function mismatch(message) {
  throw new ImpactContractError(`Alconite returned an invalid Impact report: ${message}`);
}
function record(value, context, keys, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) mismatch(`${context} must be an object`);
  const result = value;
  const allowed = /* @__PURE__ */ new Set([...keys, ...optional]);
  for (const key of Object.keys(result)) if (!allowed.has(key)) mismatch(`${context} contains an unknown field`);
  for (const key of keys) if (!(key in result)) mismatch(`${context} omitted a required field`);
  return result;
}
function stringValue(value, context, minimum, maximum) {
  if (typeof value !== "string") mismatch(`${context} must be a string`);
  const scalars = [...value].length;
  if (scalars < minimum || scalars > maximum) mismatch(`${context} is outside its supported bound`);
  return value;
}
function byteString(value, context, minimum, maximum) {
  if (typeof value !== "string") mismatch(`${context} must be a string`);
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < minimum || bytes > maximum) mismatch(`${context} is outside its supported byte bound`);
  return value;
}
function nullableString(value, context, maximum) {
  return value === null ? null : stringValue(value, context, 1, maximum);
}
function integer(value, context, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    mismatch(`${context} must be a bounded integer`);
  }
  return value;
}
function booleanValue(value, context) {
  if (typeof value !== "boolean") mismatch(`${context} must be a boolean`);
  return value;
}
function enumValue(value, context, allowed) {
  if (typeof value !== "string" || !allowed.has(value)) mismatch(`${context} is unsupported`);
  return value;
}
function arrayValue(value, context, maximum) {
  if (!Array.isArray(value) || value.length > maximum) mismatch(`${context} must be a bounded array`);
  return value;
}
function sortedUnique(values, context) {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === void 0 || current === void 0 || previous.localeCompare(current) >= 0) {
      mismatch(`${context} must be sorted and deduplicated`);
    }
  }
}
function canonicalUnique(values, canonical, context) {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === void 0 || current === void 0 || canonical.indexOf(previous) >= canonical.indexOf(current)) {
      mismatch(`${context} must be sorted and deduplicated`);
    }
  }
}
function validatePortablePath(value, context) {
  const candidate = byteString(value, context, 1, 512);
  if (candidate.includes("\\") || candidate.includes("\0") || candidate.startsWith("/") || /^[A-Za-z]:/u.test(candidate) || candidate.startsWith("//")) mismatch(`${context} is not a portable relative path`);
  const components = candidate.split("/");
  if (components.some((component) => !component || component === "." || component === "..")) {
    mismatch(`${context} is not a normalized portable path`);
  }
  return candidate;
}
function validateSkipCounts(value, context) {
  const counts = record(value, context, [], [...SKIP_CODES]);
  let total = 0;
  for (const [key, raw] of Object.entries(counts)) {
    if (!SKIP_CODE_SET.has(key)) mismatch(`${context} contains an unsupported skip code`);
    total += integer(raw, `${context}.${key}`);
  }
  return total;
}
function validateClientCollection(value, context) {
  const item = record(value, context, [
    "schemaVersion",
    "authoritative",
    "entriesVisited",
    "directoriesVisited",
    "filesDiscovered",
    "filesSubmitted",
    "filesSkipped",
    "skipCounts",
    "collectionDurationMs"
  ]);
  if (item.schemaVersion !== CLIENT_COLLECTION_SCHEMA_VERSION) mismatch(`${context}.schemaVersion is unsupported`);
  if (item.authoritative !== false) mismatch(`${context}.authoritative must be false`);
  const entries = integer(item.entriesVisited, `${context}.entriesVisited`, 0, 2e4);
  const directories = integer(item.directoriesVisited, `${context}.directoriesVisited`, 0, 5e3);
  const discovered = integer(item.filesDiscovered, `${context}.filesDiscovered`, 0, 2e4);
  const submitted = integer(item.filesSubmitted, `${context}.filesSubmitted`, 0, 2e3);
  const skipped = integer(item.filesSkipped, `${context}.filesSkipped`, 0, 2e4);
  integer(item.collectionDurationMs, `${context}.collectionDurationMs`, 0, 6e5);
  if (directories > entries || discovered !== submitted + skipped) mismatch(`${context} contains inconsistent counts`);
  if (validateSkipCounts(item.skipCounts, `${context}.skipCounts`) !== skipped) mismatch(`${context}.skipCounts is inconsistent`);
}
function validateSubject(value, kind) {
  const item = record(value, "change.subject", [
    "operation",
    "schema",
    "parameter",
    "responseStatus",
    "mediaType",
    "enumValue",
    "securityScheme",
    "securityScope",
    "metadataPointer"
  ]);
  if (item.operation !== null) {
    const operation = record(item.operation, "change.subject.operation", [
      "path",
      "method",
      "baselineOperationId",
      "candidateOperationId"
    ]);
    byteString(operation.path, "change.subject.operation.path", 1, 512);
    enumValue(operation.method, "change.subject.operation.method", HTTP_METHODS);
    nullableString(operation.baselineOperationId, "change.subject.operation.baselineOperationId", 256);
    nullableString(operation.candidateOperationId, "change.subject.operation.candidateOperationId", 256);
  }
  if (item.schema !== null) {
    const schema = record(item.schema, "change.subject.schema", ["name", "property", "uses"]);
    stringValue(schema.name, "change.subject.schema.name", 1, 256);
    nullableString(schema.property, "change.subject.schema.property", 256);
    const uses = arrayValue(schema.uses, "change.subject.schema.uses", 3).map((entry) => enumValue(entry, "change.subject.schema.uses[]", /* @__PURE__ */ new Set(["REQUEST", "RESPONSE", "UNKNOWN"])));
    if (uses.length === 0) mismatch("change.subject.schema.uses must not be empty");
    canonicalUnique(uses, ["REQUEST", "RESPONSE", "UNKNOWN"], "change.subject.schema.uses");
    if (uses.includes("UNKNOWN") && uses.length !== 1) mismatch("UNKNOWN schema use is mutually exclusive");
  }
  if (item.parameter !== null) {
    const parameter = record(item.parameter, "change.subject.parameter", ["name", "location"]);
    stringValue(parameter.name, "change.subject.parameter.name", 1, 256);
    enumValue(parameter.location, "change.subject.parameter.location", /* @__PURE__ */ new Set(["PATH", "QUERY", "HEADER", "COOKIE"]));
  }
  nullableString(item.responseStatus, "change.subject.responseStatus", 256);
  nullableString(item.mediaType, "change.subject.mediaType", 256);
  nullableString(item.enumValue, "change.subject.enumValue", 256);
  nullableString(item.securityScheme, "change.subject.securityScheme", 256);
  nullableString(item.securityScope, "change.subject.securityScope", 256);
  if (item.metadataPointer !== null) byteString(item.metadataPointer, "change.subject.metadataPointer", 1, 512);
  const present = /* @__PURE__ */ new Set();
  for (const key of ["operation", "schema", "parameter", "responseStatus", "mediaType", "enumValue", "securityScheme", "securityScope", "metadataPointer"]) {
    if (item[key] !== null) present.add(key);
  }
  if (present.size === 0) mismatch("change.subject must contain at least one subject");
  validateSubjectForKind(item, present, kind);
  return item;
}
function requireExactSubject(present, required, kind) {
  const requiredSet = new Set(required);
  if (present.size !== requiredSet.size || [...present].some((key) => !requiredSet.has(key))) {
    mismatch(`change.subject does not match ${kind}`);
  }
}
function validateSubjectForKind(item, present, kind) {
  const operationOnly = /* @__PURE__ */ new Set([
    "ENDPOINT_ADDED",
    "ENDPOINT_REMOVED",
    "HTTP_METHOD_ADDED",
    "HTTP_METHOD_REMOVED",
    "OPERATION_ID_CHANGED",
    "DEPRECATION_CHANGED",
    "REQUEST_BODY_ADDED",
    "REQUIRED_REQUEST_BODY_ADDED",
    "REQUEST_BODY_REMOVED",
    "REQUEST_BODY_REQUIREMENT_CHANGED"
  ]);
  const parameterKinds = /* @__PURE__ */ new Set([
    "PARAMETER_ADDED",
    "REQUIRED_PARAMETER_ADDED",
    "PARAMETER_REMOVED",
    "PARAMETER_TYPE_CHANGED",
    "PARAMETER_REQUIREMENT_CHANGED",
    "PARAMETER_CONSTRAINT_CHANGED"
  ]);
  const requestSchemaKinds = /* @__PURE__ */ new Set(["REQUEST_SCHEMA_CHANGED"]);
  const requestMediaKinds = /* @__PURE__ */ new Set(["REQUEST_MEDIA_TYPE_ADDED", "REQUEST_MEDIA_TYPE_REMOVED"]);
  const responseKinds = /* @__PURE__ */ new Set(["RESPONSE_ADDED", "RESPONSE_REMOVED"]);
  const responseSchemaKinds = /* @__PURE__ */ new Set(["RESPONSE_SCHEMA_CHANGED"]);
  const responseMediaKinds = /* @__PURE__ */ new Set(["RESPONSE_MEDIA_TYPE_ADDED", "RESPONSE_MEDIA_TYPE_REMOVED"]);
  const schemaKinds = /* @__PURE__ */ new Set(["SCHEMA_ADDED", "SCHEMA_REMOVED"]);
  const propertyKinds = /* @__PURE__ */ new Set([
    "PROPERTY_ADDED",
    "PROPERTY_REMOVED",
    "PROPERTY_TYPE_CHANGED",
    "PROPERTY_REQUIREMENT_CHANGED",
    "PROPERTY_CONSTRAINT_CHANGED",
    "REQUIRED_REQUEST_PROPERTY_ADDED"
  ]);
  if (operationOnly.has(kind)) return requireExactSubject(present, ["operation"], kind);
  if (parameterKinds.has(kind)) return requireExactSubject(present, ["operation", "parameter"], kind);
  if (kind === "PARAMETER_ENUM_VALUE_ADDED" || kind === "PARAMETER_ENUM_VALUE_REMOVED") {
    return requireExactSubject(present, ["operation", "parameter", "enumValue"], kind);
  }
  if (requestSchemaKinds.has(kind)) return requireExactSubject(present, ["operation", "schema"], kind);
  if (requestMediaKinds.has(kind)) return requireExactSubject(present, ["operation", "mediaType"], kind);
  if (responseKinds.has(kind)) return requireExactSubject(present, ["operation", "responseStatus"], kind);
  if (responseSchemaKinds.has(kind)) return requireExactSubject(present, ["operation", "responseStatus", "schema"], kind);
  if (responseMediaKinds.has(kind)) return requireExactSubject(present, ["operation", "responseStatus", "mediaType"], kind);
  if (schemaKinds.has(kind)) {
    requireExactSubject(present, ["schema"], kind);
    if (item.schema.property !== null) mismatch(`${kind} requires a schema without a property`);
    return;
  }
  if (propertyKinds.has(kind)) {
    requireExactSubject(present, ["schema"], kind);
    if (item.schema.property === null) mismatch(`${kind} requires a schema property`);
    return;
  }
  if (kind === "ENUM_VALUE_ADDED" || kind === "ENUM_VALUE_REMOVED") {
    return requireExactSubject(present, ["schema", "enumValue"], kind);
  }
  if (kind === "SECURITY_REQUIREMENT_STRENGTHENED" || kind === "SECURITY_REQUIREMENT_WEAKENED") {
    if (!(present.size === 1 && present.has("operation")) && !(present.size === 2 && present.has("operation") && present.has("securityScheme"))) {
      mismatch(`change.subject does not match ${kind}`);
    }
    return;
  }
  if (kind === "SECURITY_SCOPE_ADDED" || kind === "SECURITY_SCOPE_REMOVED") {
    return requireExactSubject(present, ["operation", "securityScope"], kind);
  }
  if (kind === "SECURITY_SCHEME_ADDED" || kind === "SECURITY_SCHEME_REMOVED") {
    return requireExactSubject(present, ["securityScheme"], kind);
  }
  if (kind === "SERVER_ADDED" || kind === "SERVER_REMOVED" || kind === "METADATA_CHANGED") {
    return requireExactSubject(present, ["metadataPointer"], kind);
  }
}
function validateEvidence(value) {
  const item = record(value, "affected source evidence", ["type", "value"]);
  enumValue(item.type, "affected source evidence.type", EVIDENCE_SET);
  stringValue(item.value, "affected source evidence.value", 1, 512);
  return item;
}
function validateAffectedSource(value) {
  const item = record(value, "affected source", ["file", "line", "column", "language", "confidence", "evidence"]);
  validatePortablePath(item.file, "affected source.file");
  integer(item.line, "affected source.line", 1);
  integer(item.column, "affected source.column", 1);
  enumValue(item.language, "affected source.language", LANGUAGE_SET);
  enumValue(item.confidence, "affected source.confidence", CONFIDENCE_SET);
  const evidence = arrayValue(item.evidence, "affected source.evidence", 12).map(validateEvidence);
  if (evidence.length === 0) mismatch("affected source.evidence must not be empty");
  const evidenceKeys = evidence.map((entry) => `${EVIDENCE_TYPES.indexOf(entry.type)}\0${entry.value}`);
  sortedUnique(evidenceKeys, "affected source.evidence");
  return item;
}
function validateConfidenceBasis(value, confidence, risk) {
  const item = record(value, "change.confidenceBasis", ["level", "conditions", "evidenceTypes", "criticalRisk"]);
  const level = item.level === null ? null : enumValue(item.level, "change.confidenceBasis.level", CONFIDENCE_SET);
  if (level !== confidence) mismatch("change.confidenceBasis.level disagrees with confidence");
  const conditions = arrayValue(item.conditions, "change.confidenceBasis.conditions", CONFIDENCE_CONDITIONS.length).map((entry) => enumValue(entry, "change.confidenceBasis.conditions[]", CONDITION_SET));
  canonicalUnique(conditions, CONFIDENCE_CONDITIONS, "change.confidenceBasis.conditions");
  const evidenceTypes = arrayValue(item.evidenceTypes, "change.confidenceBasis.evidenceTypes", EVIDENCE_TYPES.length).map((entry) => enumValue(entry, "change.confidenceBasis.evidenceTypes[]", EVIDENCE_SET));
  canonicalUnique(evidenceTypes, EVIDENCE_TYPES, "change.confidenceBasis.evidenceTypes");
  if (confidence === null && (conditions.length !== 0 || evidenceTypes.length !== 0 || item.criticalRisk !== null)) {
    mismatch("empty confidence must have an empty confidence basis");
  }
  if (risk === "CRITICAL" !== (item.criticalRisk !== null)) mismatch("criticalRisk basis disagrees with risk");
  if (item.criticalRisk !== null) {
    const critical = record(item.criticalRisk, "change.confidenceBasis.criticalRisk", [
      "destructiveKind",
      "minimumAffectedFiles",
      "minimumHighConfidenceFiles",
      "affectedFiles",
      "highConfidenceFiles"
    ]);
    if (critical.destructiveKind !== true) mismatch("criticalRisk.destructiveKind must be true");
    integer(critical.minimumAffectedFiles, "criticalRisk.minimumAffectedFiles", 10, 10);
    integer(critical.minimumHighConfidenceFiles, "criticalRisk.minimumHighConfidenceFiles", 5, 5);
    integer(critical.affectedFiles, "criticalRisk.affectedFiles", 10);
    integer(critical.highConfidenceFiles, "criticalRisk.highConfidenceFiles", 5);
  }
}
function validateChange(value) {
  const item = record(value, "change", [
    "id",
    "deltaFingerprint",
    "kind",
    "classification",
    "category",
    "ruleId",
    "ruleVersion",
    "summary",
    "explanation",
    "baselineValue",
    "candidateValue",
    "subject",
    "potentialRisk",
    "risk",
    "confidence",
    "confidenceBasis",
    "affectedLocationCount",
    "returnedAffectedLocationCount",
    "omittedAffectedLocationCount",
    "affectedFileCount",
    "highConfidenceFileCount",
    "affectedSources",
    "recommendation"
  ]);
  if (typeof item.id !== "string" || !/^cgdelta_[a-f0-9]{32}$/u.test(item.id)) mismatch("change.id is invalid");
  if (typeof item.deltaFingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(item.deltaFingerprint)) mismatch("change.deltaFingerprint is invalid");
  const kind = enumValue(item.kind, "change.kind", CHANGE_KIND_SET);
  enumValue(item.classification, "change.classification", CLASSIFICATIONS);
  enumValue(item.category, "change.category", CATEGORIES);
  byteString(item.ruleId, "change.ruleId", 1, 64);
  integer(item.ruleVersion, "change.ruleVersion", 1);
  stringValue(item.summary, "change.summary", 1, 200);
  stringValue(item.explanation, "change.explanation", 1, 1e3);
  if (item.baselineValue !== null) stringValue(item.baselineValue, "change.baselineValue", 0, 500);
  if (item.candidateValue !== null) stringValue(item.candidateValue, "change.candidateValue", 0, 500);
  validateSubject(item.subject, kind);
  const potentialRisk = enumValue(item.potentialRisk, "change.potentialRisk", RISK_SET);
  const risk = enumValue(item.risk, "change.risk", RISK_SET);
  const confidence = item.confidence === null ? null : enumValue(item.confidence, "change.confidence", CONFIDENCE_SET);
  validateConfidenceBasis(item.confidenceBasis, confidence, risk);
  const total = integer(item.affectedLocationCount, "change.affectedLocationCount");
  const returned = integer(item.returnedAffectedLocationCount, "change.returnedAffectedLocationCount");
  const omitted = integer(item.omittedAffectedLocationCount, "change.omittedAffectedLocationCount");
  const files = integer(item.affectedFileCount, "change.affectedFileCount");
  const highFiles = integer(item.highConfidenceFileCount, "change.highConfidenceFileCount");
  const sources = arrayValue(item.affectedSources, "change.affectedSources", 200).map(validateAffectedSource);
  if (total !== returned + omitted || returned !== sources.length || files > total || highFiles > files) {
    mismatch("change affected-source counts are inconsistent");
  }
  if (total === 0 !== (confidence === null) || total === 0 !== (risk === "NONE")) {
    mismatch("change confidence/risk does not match its affected-source count");
  }
  if (total > 0 && potentialRisk === "NONE") mismatch("an affected change cannot have NONE potential risk");
  const recommendation = record(item.recommendation, "change.recommendation", ["code", "message"]);
  if (typeof recommendation.code !== "string" || !/^[a-z][a-z0-9_]{0,99}$/u.test(recommendation.code)) {
    mismatch("change.recommendation.code is invalid");
  }
  stringValue(recommendation.message, "change.recommendation.message", 1, 1e3);
  const compactRow = { ...item, affectedSources: [] };
  if (Buffer.byteLength(JSON.stringify(compactRow), "utf8") > 6144) mismatch("change compact row exceeds its bound");
  return item;
}
function validateServerScan(value) {
  const item = record(value, "metadata.serverScan", [
    "inputType",
    "authoritative",
    "manifestEntriesSubmitted",
    "filesystemEntriesVisited",
    "directoriesVisited",
    "gitignoreFilesRead",
    "gitignoreBytesRead",
    "gitignorePatternsParsed",
    "filesAccepted",
    "filesScanned",
    "filesSkipped",
    "bytesScanned",
    "indexedSymbolVariants",
    "indexedSymbolBytes",
    "lexerTokens",
    "skipCounts"
  ]);
  enumValue(item.inputType, "metadata.serverScan.inputType", /* @__PURE__ */ new Set(["INLINE_MANIFEST", "TRUSTED_FILESYSTEM"]));
  if (item.authoritative !== true) mismatch("metadata.serverScan.authoritative must be true");
  if (item.manifestEntriesSubmitted !== null) integer(item.manifestEntriesSubmitted, "metadata.serverScan.manifestEntriesSubmitted", 0, 2500);
  if (item.filesystemEntriesVisited !== null) integer(item.filesystemEntriesVisited, "metadata.serverScan.filesystemEntriesVisited", 0, 2e4);
  if (item.directoriesVisited !== null) integer(item.directoriesVisited, "metadata.serverScan.directoriesVisited", 0, 5e3);
  integer(item.gitignoreFilesRead, "metadata.serverScan.gitignoreFilesRead", 0, 128);
  integer(item.gitignoreBytesRead, "metadata.serverScan.gitignoreBytesRead", 0, 512 * 1024);
  integer(item.gitignorePatternsParsed, "metadata.serverScan.gitignorePatternsParsed", 0, 1e4);
  integer(item.filesAccepted, "metadata.serverScan.filesAccepted", 0, 2e3);
  integer(item.filesScanned, "metadata.serverScan.filesScanned", 0, 2e3);
  integer(item.filesSkipped, "metadata.serverScan.filesSkipped", 0, 2500);
  integer(item.bytesScanned, "metadata.serverScan.bytesScanned", 0, 16 * 1024 * 1024);
  integer(item.indexedSymbolVariants, "metadata.serverScan.indexedSymbolVariants", 0, 1e5);
  integer(item.indexedSymbolBytes, "metadata.serverScan.indexedSymbolBytes", 0, 8 * 1024 * 1024);
  integer(item.lexerTokens, "metadata.serverScan.lexerTokens", 0, 5e6);
  if (item.inputType === "INLINE_MANIFEST") {
    if (item.manifestEntriesSubmitted === null || item.filesystemEntriesVisited !== null || item.directoriesVisited !== null) {
      mismatch("metadata.serverScan counters do not match INLINE_MANIFEST");
    }
    if (item.gitignoreFilesRead !== 0 || item.gitignoreBytesRead !== 0 || item.gitignorePatternsParsed !== 0) {
      mismatch("inline manifests cannot report server gitignore reads");
    }
    if (item.filesAccepted + item.filesSkipped !== item.manifestEntriesSubmitted) {
      mismatch("metadata.serverScan manifest counts are inconsistent");
    }
  } else if (item.manifestEntriesSubmitted !== null || item.filesystemEntriesVisited === null || item.directoriesVisited === null) {
    mismatch("metadata.serverScan counters do not match TRUSTED_FILESYSTEM");
  }
  if (item.filesScanned > item.filesAccepted) mismatch("metadata.serverScan scanned too many files");
  if (validateSkipCounts(item.skipCounts, "metadata.serverScan.skipCounts") !== item.filesSkipped) {
    mismatch("metadata.serverScan.skipCounts is inconsistent");
  }
}
function validateWarning(value) {
  const item = record(value, "metadata warning", ["code", "message"], ["path"]);
  enumValue(item.code, "metadata warning.code", WARNING_SET);
  stringValue(item.message, "metadata warning.message", 1, 200);
  if ("path" in item) validatePortablePath(item.path, "metadata warning.path");
}
function validateContract(value, expectedProjectId, expectedCheckId) {
  const item = record(value, "contract", [
    "type",
    "projectId",
    "checkId",
    "baselineVersionId",
    "candidateVersionId",
    "baselineContentHash",
    "candidateContentHash",
    "baselineOpenapiVersion",
    "candidateOpenapiVersion"
  ]);
  if (item.type !== "CONTRACT_GUARD_CHECK") mismatch("contract.type is unsupported by the Action");
  if (item.projectId !== expectedProjectId || item.checkId !== expectedCheckId) mismatch("contract identifiers do not match the request");
  if (typeof item.projectId !== "string" || !/^cgprj_[0-9a-f]{32}$/u.test(item.projectId)) mismatch("contract.projectId is invalid");
  if (typeof item.checkId !== "string" || !/^cgchk_[0-9a-f]{32}$/u.test(item.checkId)) mismatch("contract.checkId is invalid");
  for (const key of ["baselineVersionId", "candidateVersionId"]) {
    if (typeof item[key] !== "string" || !/^cgver_[0-9a-f]{32}$/u.test(item[key])) mismatch(`contract.${key} is invalid`);
  }
  for (const key of ["baselineContentHash", "candidateContentHash"]) {
    if (typeof item[key] !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(item[key])) mismatch(`contract.${key} is invalid`);
  }
  for (const key of ["baselineOpenapiVersion", "candidateOpenapiVersion"]) {
    if (typeof item[key] !== "string" || !/^3\.(?:0|1)\.\d+$/u.test(item[key])) mismatch(`contract.${key} is unsupported`);
  }
}
function validateEngines(value) {
  const item = record(value, "engines", [
    "analyzerVersion",
    "analyzerRuleSetVersion",
    "analyzerCompatibilityVersion",
    "legacyComparisonEngineVersion",
    "contractDeltaEngineVersion",
    "impactAnalysisEngineVersion"
  ]);
  stringValue(item.analyzerVersion, "engines.analyzerVersion", 1, 80);
  for (const key of [
    "analyzerRuleSetVersion",
    "analyzerCompatibilityVersion",
    "legacyComparisonEngineVersion",
    "contractDeltaEngineVersion",
    "impactAnalysisEngineVersion"
  ]) integer(item[key], `engines.${key}`, 1);
}
function validateImpactReport(value, expectedProjectId, expectedCheckId) {
  const item = record(value, "report", [
    "schemaVersion",
    "analysisFingerprint",
    "contract",
    "engines",
    "overallRisk",
    "overallPotentialRisk",
    "breakingChanges",
    "affectedFiles",
    "affectedSourceLocations",
    "changes",
    "metadata"
  ]);
  if (item.schemaVersion !== IMPACT_REPORT_SCHEMA_VERSION) mismatch("schemaVersion is unsupported");
  if (typeof item.analysisFingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(item.analysisFingerprint)) {
    mismatch("analysisFingerprint is invalid");
  }
  validateContract(item.contract, expectedProjectId, expectedCheckId);
  validateEngines(item.engines);
  const overallRisk = enumValue(item.overallRisk, "overallRisk", RISK_SET);
  const overallPotentialRisk = enumValue(item.overallPotentialRisk, "overallPotentialRisk", RISK_SET);
  const breaking = integer(item.breakingChanges, "breakingChanges");
  const affectedFiles = integer(item.affectedFiles, "affectedFiles");
  const affectedLocations = integer(item.affectedSourceLocations, "affectedSourceLocations");
  const changes = arrayValue(item.changes, "changes", 1e3).map(validateChange);
  if (changes.filter((change) => change.classification === "breaking").length !== breaking) mismatch("breakingChanges is inconsistent");
  const riskRank = (risk) => RISK_VALUES.indexOf(risk);
  const expectedRisk = changes.reduce((maximum, change) => riskRank(change.risk) > riskRank(maximum) ? change.risk : maximum, "NONE");
  const expectedPotential = changes.reduce((maximum, change) => riskRank(change.potentialRisk) > riskRank(maximum) ? change.potentialRisk : maximum, "NONE");
  if (overallRisk !== expectedRisk || overallPotentialRisk !== expectedPotential) mismatch("overall risk values are inconsistent");
  if (changes.reduce((sum, change) => sum + change.affectedLocationCount, 0) !== affectedLocations) {
    mismatch("affectedSourceLocations is inconsistent");
  }
  const returnedFiles = new Set(changes.flatMap((change) => change.affectedSources.map((source) => source.file)));
  if (affectedFiles < returnedFiles.size || affectedFiles > affectedLocations) mismatch("affectedFiles is inconsistent");
  const metadata = record(item.metadata, "metadata", [
    "serverScan",
    "languagesDetected",
    "warnings",
    "warningsOmitted",
    "truncated",
    "totalAffectedSourceLocations",
    "returnedAffectedSourceLocations",
    "changesWithoutReturnedLocations",
    "analysisDurationMs"
  ], ["clientCollection"]);
  validateServerScan(metadata.serverScan);
  if ("clientCollection" in metadata) validateClientCollection(metadata.clientCollection, "metadata.clientCollection");
  const languages = arrayValue(metadata.languagesDetected, "metadata.languagesDetected", SOURCE_LANGUAGES.length).map((entry) => enumValue(entry, "metadata.languagesDetected[]", LANGUAGE_SET));
  canonicalUnique(languages, SOURCE_LANGUAGES, "metadata.languagesDetected");
  const warnings = arrayValue(metadata.warnings, "metadata.warnings", 200);
  warnings.forEach(validateWarning);
  const warningsOmitted = integer(metadata.warningsOmitted, "metadata.warningsOmitted");
  const truncated = booleanValue(metadata.truncated, "metadata.truncated");
  const total = integer(metadata.totalAffectedSourceLocations, "metadata.totalAffectedSourceLocations");
  const returned = integer(metadata.returnedAffectedSourceLocations, "metadata.returnedAffectedSourceLocations");
  const changesWithout = integer(metadata.changesWithoutReturnedLocations, "metadata.changesWithoutReturnedLocations");
  integer(metadata.analysisDurationMs, "metadata.analysisDurationMs");
  const expectedReturned = changes.reduce((sum, change) => sum + change.returnedAffectedLocationCount, 0);
  const expectedChangesWithout = changes.filter((change) => change.affectedLocationCount > 0 && change.returnedAffectedLocationCount === 0).length;
  if (total !== affectedLocations || returned !== expectedReturned || changesWithout !== expectedChangesWithout) {
    mismatch("metadata affected-source counts are inconsistent");
  }
  if (returned > 5e3) mismatch("metadata.returnedAffectedSourceLocations exceeds the Standard profile");
  const evidenceOmitted = changes.some((change) => change.omittedAffectedLocationCount > 0);
  if (truncated !== (evidenceOmitted || warningsOmitted > 0 || warnings.some((warning) => warning.code === "EVIDENCE_TRUNCATED"))) mismatch("metadata.truncated is inconsistent");
  return item;
}

// src/impact/platform-client.ts
var MAX_REQUEST_BYTES = 24 * 1024 * 1024;
var MAX_ERROR_BYTES = 64 * 1024;
var RETRYABLE_CODES = /* @__PURE__ */ new Set(["impact_analysis_busy", "impact_storage_unavailable"]);
function validateProjectId(value) {
  const projectId = value.trim();
  if (!/^cgprj_[0-9a-f]{32}$/u.test(projectId)) {
    throw new ImpactActionError("invalid_input", "project-id must be a Contract Guard identifier beginning with cgprj_.");
  }
  return projectId;
}
function validateCheckId(value) {
  const checkId = value.trim();
  if (!/^cgchk_[0-9a-f]{32}$/u.test(checkId)) {
    throw new ImpactActionError("invalid_input", "check-id must be a Contract Guard identifier beginning with cgchk_.");
  }
  return checkId;
}
function validateProjectToken(value) {
  const token = value.trim();
  if (!token.startsWith("alc_cg_") || token.length <= 7 || token.length > 512 || /[\r\n\0]/u.test(token)) {
    throw new ImpactActionError("invalid_input", "project-token must be a bounded Alconite project token beginning with alc_cg_.");
  }
  return token;
}
function validateApiUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch (error2) {
    throw new ImpactActionError("invalid_input", "api-url must be a valid absolute URL.", { cause: error2 });
  }
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new ImpactActionError("invalid_input", "api-url must use HTTPS except for loopback testing.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ImpactActionError("invalid_input", "api-url must not contain credentials, a query string, or a fragment.");
  }
  return url.toString().replace(/\/+$/u, "");
}
function endpoint(options) {
  return `${options.apiUrl}/api/v1/contract-guard/projects/${encodeURIComponent(options.projectId)}/checks/${encodeURIComponent(options.checkId)}/impact`;
}
async function readBoundedBytes(response, maximumBytes) {
  const declaredRaw = response.headers.get("content-length");
  if (declaredRaw && /^\d+$/u.test(declaredRaw) && Number(declaredRaw) > maximumBytes) {
    await response.body?.cancel().catch(() => void 0);
    throw new ImpactActionError("platform_contract_mismatch", "Alconite returned an oversized Impact response.", { status: response.status });
  }
  if (!response.body) {
    throw new ImpactActionError("platform_contract_mismatch", "Alconite returned an empty Impact response.", { status: response.status });
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => void 0);
      throw new ImpactActionError("platform_contract_mismatch", "Alconite returned an oversized Impact response.", { status: response.status });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
async function readBoundedJson(response, maximumBytes) {
  const bytes = await readBoundedBytes(response, maximumBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error2) {
    throw new ImpactActionError("platform_contract_mismatch", "Alconite returned malformed Impact JSON.", {
      status: response.status,
      cause: error2
    });
  }
}
function errorEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const outer = value;
  if (!outer.error || typeof outer.error !== "object" || Array.isArray(outer.error)) return void 0;
  const error2 = outer.error;
  if (typeof error2.code !== "string" || !/^[a-z][a-z0-9_]{0,79}$/u.test(error2.code)) return void 0;
  if (typeof error2.message !== "string" || [...error2.message].length < 1 || [...error2.message].length > 300) return void 0;
  return { code: error2.code };
}
function retryAfterMilliseconds(value) {
  if (!value || !/^\d+$/u.test(value)) return void 0;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) return void 0;
  return Math.min(seconds * 1e3, 3e4);
}
function backoff(attempt) {
  return Math.min(1e3 * 2 ** Math.max(0, attempt - 1), 1e4);
}
var ImpactPlatformClient = class {
  constructor(options) {
    this.options = options;
    if (!Number.isSafeInteger(options.attempts) || options.attempts < 1 || options.attempts > 5) {
      throw new ImpactActionError("invalid_input", "attempts must be an integer from 1 through 5.");
    }
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  }
  options;
  fetchImplementation;
  async analyze(request) {
    const body = JSON.stringify(request);
    const requestBytes = Buffer.byteLength(body, "utf8");
    if (requestBytes > MAX_REQUEST_BYTES) {
      throw new ImpactActionError("collection_limit_exceeded", `The encoded Impact request exceeds the ${MAX_REQUEST_BYTES}-byte limit.`);
    }
    let lastNetworkError;
    for (let attempt = 1; attempt <= this.options.attempts; attempt += 1) {
      this.options.deadline.throwIfExpired();
      let response;
      try {
        response = await this.fetchImplementation(endpoint(this.options), {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${this.options.projectToken}`,
            "content-type": "application/json",
            "user-agent": "alconite-impact-action/2.2.0-draft"
          },
          body,
          redirect: "manual",
          signal: this.options.deadline.signal()
        });
      } catch (error2) {
        lastNetworkError = error2;
        try {
          this.options.deadline.throwIfExpired();
        } catch (deadlineError) {
          throw deadlineError;
        }
        if (attempt >= this.options.attempts) break;
        await this.options.deadline.wait(backoff(attempt));
        continue;
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => void 0);
        throw new ImpactActionError("platform_request_failed", "Alconite Impact redirects are refused to protect the project token.", {
          status: response.status
        });
      }
      if (response.status === 200) {
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        if (contentType !== "application/json") {
          await response.body?.cancel().catch(() => void 0);
          throw new ImpactActionError("platform_contract_mismatch", "Alconite returned an unsupported Impact response content type.", {
            status: response.status
          });
        }
        const raw = await readBoundedJson(response, MAX_REPORT_BYTES);
        return validateImpactReport(raw, this.options.projectId, this.options.checkId);
      }
      if (response.status === 502 && attempt < this.options.attempts) {
        await response.body?.cancel().catch(() => void 0);
        await this.options.deadline.wait(retryAfterMilliseconds(response.headers.get("retry-after")) ?? backoff(attempt));
        continue;
      }
      let rawError;
      try {
        rawError = await readBoundedJson(response, MAX_ERROR_BYTES);
      } catch {
        rawError = void 0;
      }
      const envelope = errorEnvelope(rawError);
      const retryableGateway = response.status === 504 && !envelope;
      const retryableCode = envelope ? RETRYABLE_CODES.has(envelope.code) : false;
      if ((retryableGateway || retryableCode) && attempt < this.options.attempts) {
        await this.options.deadline.wait(retryAfterMilliseconds(response.headers.get("retry-after")) ?? backoff(attempt));
        continue;
      }
      const suffix = envelope ? ` (${envelope.code})` : "";
      throw new ImpactActionError(
        "platform_request_failed",
        `Alconite rejected Impact analysis with HTTP ${response.status}${suffix}.`,
        { status: response.status, platformCode: envelope?.code }
      );
    }
    throw new ImpactActionError(
      "platform_request_failed",
      `Alconite Impact network request failed after ${this.options.attempts} attempt(s).`,
      { cause: lastNetworkError }
    );
  }
};

// src/impact/report.ts
var import_node_fs3 = require("node:fs");
var import_node_path2 = __toESM(require("node:path"));

// src/impact/secure-filesystem.ts
var import_node_fs2 = require("node:fs");
var import_node_path = __toESM(require("node:path"));
function sourceUnsupported(message) {
  throw new ImpactActionError("unsupported_secure_source_filesystem", message);
}
function stableIdentity(stats, purpose = "source") {
  if (stats.ino <= 0n || stats.dev < 0n) {
    const code = purpose === "report" ? "unsupported_secure_report_filesystem" : "unsupported_secure_source_filesystem";
    throw new ImpactActionError(code, `The runner filesystem does not expose stable identity required for secure ${purpose} handling.`);
  }
  return { dev: stats.dev, ino: stats.ino, mode: stats.mode };
}
function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}
function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(import_node_path.default.normalize(left)) === normalize(import_node_path.default.normalize(right));
}
function isContained(parent, child, allowEqual = true) {
  const relative = import_node_path.default.relative(parent, child);
  if (relative === "") return allowEqual;
  return relative !== ".." && !relative.startsWith(`..${import_node_path.default.sep}`) && !import_node_path.default.isAbsolute(relative);
}
async function lstatBigInt(filename) {
  return import_node_fs2.promises.lstat(filename, { bigint: true });
}
async function verifyAbsoluteDirectory(requested, purpose, deadline) {
  deadline.throwIfExpired();
  if (!import_node_path.default.isAbsolute(requested)) {
    const code = purpose === "report" ? "unsupported_secure_report_filesystem" : "unsupported_secure_source_filesystem";
    throw new ImpactActionError(code, `The ${purpose} root must be an absolute existing directory.`);
  }
  const resolved = import_node_path.default.resolve(requested);
  const parsed = import_node_path.default.parse(resolved);
  const components = import_node_path.default.relative(parsed.root, resolved).split(import_node_path.default.sep).filter(Boolean);
  let current = parsed.root;
  for (const component of components) {
    deadline.throwIfExpired();
    current = import_node_path.default.join(current, component);
    const stats = await lstatBigInt(current).catch((error2) => {
      const code = purpose === "report" ? "unsupported_secure_report_filesystem" : "unsupported_secure_source_filesystem";
      throw new ImpactActionError(code, `The ${purpose} root is not an accessible existing directory.`, { cause: error2 });
    });
    if (stats.isSymbolicLink()) {
      const code = purpose === "report" ? "unsupported_secure_report_filesystem" : "unsupported_secure_source_filesystem";
      throw new ImpactActionError(code, `The ${purpose} root contains a symbolic link or junction component.`);
    }
  }
  const before = await lstatBigInt(resolved);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    const code = purpose === "report" ? "unsupported_secure_report_filesystem" : "unsupported_secure_source_filesystem";
    throw new ImpactActionError(code, `The ${purpose} root must be a non-link directory.`);
  }
  const identity = stableIdentity(before, purpose);
  const realPath = await import_node_fs2.promises.realpath(resolved);
  const after = await lstatBigInt(resolved);
  if (!sameIdentity(identity, stableIdentity(after, purpose)) || !after.isDirectory() || !samePath(realPath, await import_node_fs2.promises.realpath(resolved))) {
    throw new ImpactActionError(
      purpose === "report" ? "unsupported_secure_report_filesystem" : "source_race_detected",
      `The ${purpose} root changed while its identity was being established.`
    );
  }
  return { path: resolved, realPath, identity };
}
async function assertDirectoryIdentity(directory, purpose) {
  const stats = await lstatBigInt(directory.path);
  const realPath = await import_node_fs2.promises.realpath(directory.path);
  if (!stats.isDirectory() || stats.isSymbolicLink() || !sameIdentity(directory.identity, stableIdentity(stats, purpose)) || !samePath(realPath, directory.realPath)) {
    throw new ImpactActionError(
      purpose === "report" ? "unsupported_secure_report_filesystem" : "source_race_detected",
      `The verified ${purpose} root changed during the operation.`
    );
  }
}
function noFollowFlags(directory = false) {
  const noFollow = import_node_fs2.constants.O_NOFOLLOW;
  if (process.platform !== "win32" && typeof noFollow !== "number") sourceUnsupported("The runner does not expose O_NOFOLLOW.");
  let flags = import_node_fs2.constants.O_RDONLY | (typeof noFollow === "number" ? noFollow : 0);
  if (directory && typeof import_node_fs2.constants.O_DIRECTORY === "number") flags |= import_node_fs2.constants.O_DIRECTORY;
  return flags;
}
async function openVerifiedDirectoryHandle(directory, before) {
  if (process.platform === "win32") return void 0;
  const handle = await import_node_fs2.promises.open(directory, noFollowFlags(true));
  const opened = await handle.stat({ bigint: true });
  if (!opened.isDirectory() || !sameIdentity(before, stableIdentity(opened))) {
    await handle.close().catch(() => void 0);
    throw new ImpactActionError("source_race_detected", "A source directory changed before it could be opened securely.");
  }
  return handle;
}
async function readVerifiedDirectory(directory, workspace, deadline, hooks = {}, maximumEntries = Number.MAX_SAFE_INTEGER) {
  deadline.throwIfExpired();
  await assertDirectoryIdentity(workspace, "source");
  const beforeStats = await lstatBigInt(directory);
  if (!beforeStats.isDirectory() || beforeStats.isSymbolicLink()) {
    throw new ImpactActionError("source_race_detected", "A source directory is a link or is not a directory.");
  }
  const before = stableIdentity(beforeStats);
  const beforeReal = await import_node_fs2.promises.realpath(directory);
  if (!isContained(workspace.realPath, beforeReal)) {
    throw new ImpactActionError("source_race_detected", "A source directory resolved outside the workspace.");
  }
  await hooks.beforeDirectoryRead?.(directory);
  let handle;
  try {
    handle = await openVerifiedDirectoryHandle(directory, before);
    const entries = [];
    const openedDirectory = await import_node_fs2.promises.opendir(directory);
    try {
      for await (const entry of openedDirectory) {
        if (entries.length >= maximumEntries) {
          throw new ImpactActionError("collection_limit_exceeded", "Source collection exceeded the entry-visit limit.");
        }
        entries.push(entry);
      }
    } finally {
      await openedDirectory.close().catch((error2) => {
        if (error2.code !== "ERR_DIR_CLOSED") throw error2;
      });
    }
    const afterStats = await lstatBigInt(directory);
    const afterReal = await import_node_fs2.promises.realpath(directory);
    const handleStats = handle ? await handle.stat({ bigint: true }) : afterStats;
    if (!afterStats.isDirectory() || afterStats.isSymbolicLink() || !sameIdentity(before, stableIdentity(afterStats)) || !sameIdentity(before, stableIdentity(handleStats)) || !samePath(beforeReal, afterReal) || !isContained(workspace.realPath, afterReal)) {
      throw new ImpactActionError("source_race_detected", "A source directory changed during enumeration.");
    }
    return entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  } finally {
    await handle?.close().catch(() => void 0);
  }
}
async function readVerifiedFile(filename, workspace, maximumBytes, deadline, hooks = {}) {
  deadline.throwIfExpired();
  await assertDirectoryIdentity(workspace, "source");
  const beforeStats = await lstatBigInt(filename);
  if (!beforeStats.isFile() || beforeStats.isSymbolicLink()) {
    throw new ImpactActionError("source_race_detected", "A selected source entry is a link or is not a regular file.");
  }
  const before = stableIdentity(beforeStats);
  const beforeSize = Number(beforeStats.size);
  if (!Number.isSafeInteger(beforeSize) || beforeSize < 0) sourceUnsupported("The runner returned an unsupported file size.");
  const beforeReal = await import_node_fs2.promises.realpath(filename);
  if (!isContained(workspace.realPath, beforeReal)) {
    throw new ImpactActionError("source_race_detected", "A selected source file resolved outside the workspace.");
  }
  await hooks.beforeFileOpen?.(filename);
  const handle = await import_node_fs2.promises.open(filename, noFollowFlags(false)).catch((error2) => {
    throw new ImpactActionError("source_file_read_failed", "A selected source file could not be opened securely.", { cause: error2 });
  });
  try {
    const openedStats = await handle.stat({ bigint: true });
    if (!openedStats.isFile() || !sameIdentity(before, stableIdentity(openedStats))) {
      throw new ImpactActionError("source_race_detected", "A selected source file changed before it was opened.");
    }
    const allocation = Math.min(maximumBytes + 1, Math.max(1, beforeSize + 1));
    const buffer = Buffer.allocUnsafe(allocation);
    let total = 0;
    while (total < buffer.length) {
      deadline.throwIfExpired();
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    await hooks.afterFileRead?.(filename);
    const openedAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstatBigInt(filename);
    const afterReal = await import_node_fs2.promises.realpath(filename);
    if (!openedAfter.isFile() || !pathAfter.isFile() || pathAfter.isSymbolicLink() || !sameIdentity(before, stableIdentity(openedAfter)) || !sameIdentity(before, stableIdentity(pathAfter)) || openedAfter.size !== beforeStats.size || pathAfter.size !== beforeStats.size || total !== beforeSize || !samePath(beforeReal, afterReal) || !isContained(workspace.realPath, afterReal)) {
      throw new ImpactActionError("source_race_detected", "A selected source file changed while it was read.");
    }
    return { bytes: buffer.subarray(0, total), identity: before, size: total };
  } finally {
    await handle.close().catch(() => void 0);
  }
}
async function inspectEntry(filename) {
  return lstatBigInt(filename);
}

// src/impact/report.ts
function parseRiskThreshold(value, name) {
  const threshold = value.trim().toLowerCase();
  if (!["never", "low", "medium", "high", "critical"].includes(threshold)) {
    throw new ImpactActionError("invalid_input", `${name} must be one of: never, low, medium, high, critical.`);
  }
  return threshold;
}
function shouldFailRisk(risk, threshold) {
  if (threshold === "never") return false;
  return RISK_VALUES.indexOf(risk) >= RISK_VALUES.indexOf(threshold.toUpperCase());
}
function fileIdentity(stats) {
  return stableIdentity(stats, "report");
}
async function safeFailureCleanup(root, directory, filename, identity) {
  try {
    await assertDirectoryIdentity(root, "report");
    if (filename && identity) {
      const stats = await import_node_fs3.promises.lstat(filename, { bigint: true });
      if (stats.isFile() && !stats.isSymbolicLink() && sameIdentity(identity, fileIdentity(stats))) {
        await import_node_fs3.promises.unlink(filename);
      }
    }
    if (directory) {
      await assertDirectoryIdentity(directory, "report");
      if ((await import_node_fs3.promises.readdir(directory.path)).length === 0) await import_node_fs3.promises.rmdir(directory.path);
    }
  } catch {
  }
}
async function writePrivateReport(report, runnerTemp, workspacePath, deadline, hooks = {}) {
  deadline.throwIfExpired();
  if (process.platform === "win32") {
    throw new ImpactActionError(
      "unsupported_secure_report_filesystem",
      "Secure Impact report creation is unavailable on this Windows Node filesystem; use a supported Linux runner."
    );
  }
  const workspace = await verifyAbsoluteDirectory(import_node_path2.default.resolve(workspacePath), "source", deadline);
  const root = await verifyAbsoluteDirectory(import_node_path2.default.resolve(runnerTemp), "report", deadline);
  if (isContained(workspace.realPath, root.realPath)) {
    throw new ImpactActionError("unsupported_secure_report_filesystem", "RUNNER_TEMP must resolve outside GITHUB_WORKSPACE.");
  }
  await assertDirectoryIdentity(root, "report");
  const bytes = Buffer.from(`${JSON.stringify(report)}
`, "utf8");
  let directory;
  let filename;
  let createdIdentity;
  let handle;
  try {
    const createdPath = await import_node_fs3.promises.mkdtemp(import_node_path2.default.join(root.path, "alconite-impact-"));
    await import_node_fs3.promises.chmod(createdPath, 448);
    directory = await verifyAbsoluteDirectory(createdPath, "report", deadline);
    const directoryStats = await import_node_fs3.promises.lstat(directory.path, { bigint: true });
    if ((Number(directoryStats.mode) & 511) !== 448 || !isContained(root.realPath, directory.realPath, false)) {
      throw new ImpactActionError("unsupported_secure_report_filesystem", "The private Impact report directory failed mode or containment verification.");
    }
    await assertDirectoryIdentity(root, "report");
    filename = import_node_path2.default.join(directory.path, "impact-report.json");
    if (typeof import_node_fs3.constants.O_NOFOLLOW !== "number") {
      throw new ImpactActionError("unsupported_secure_report_filesystem", "The runner does not expose O_NOFOLLOW for private report creation.");
    }
    handle = await import_node_fs3.promises.open(
      filename,
      import_node_fs3.constants.O_CREAT | import_node_fs3.constants.O_EXCL | import_node_fs3.constants.O_NOFOLLOW | import_node_fs3.constants.O_WRONLY,
      384
    );
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) throw new ImpactActionError("report_write_failed", "The private Impact report destination is not a regular file.");
    createdIdentity = fileIdentity(opened);
    if ((Number(opened.mode) & 511) !== 384) {
      throw new ImpactActionError("unsupported_secure_report_filesystem", "The private Impact report file mode could not be enforced.");
    }
    await hooks.afterFileCreated?.(filename);
    await handle.writeFile(bytes);
    await handle.sync();
    deadline.throwIfExpired();
    const afterWrite = await handle.stat({ bigint: true });
    if (!afterWrite.isFile() || !sameIdentity(createdIdentity, fileIdentity(afterWrite)) || afterWrite.size !== BigInt(bytes.length)) {
      throw new ImpactActionError("report_write_failed", "The private Impact report changed while it was written.");
    }
    await handle.close();
    handle = void 0;
    const pathStats = await import_node_fs3.promises.lstat(filename, { bigint: true });
    const finalPath = await import_node_fs3.promises.realpath(filename);
    if (!pathStats.isFile() || pathStats.isSymbolicLink() || !sameIdentity(createdIdentity, fileIdentity(pathStats)) || !isContained(directory.realPath, finalPath, false)) {
      throw new ImpactActionError("report_write_failed", "The private Impact report failed final identity verification.");
    }
    await assertDirectoryIdentity(directory, "report");
    await assertDirectoryIdentity(root, "report");
    return filename;
  } catch (error2) {
    await handle?.close().catch(() => void 0);
    await safeFailureCleanup(root, directory, filename, createdIdentity);
    if (error2 instanceof ImpactActionError) throw error2;
    throw new ImpactActionError("report_write_failed", "The private Impact report could not be created securely.", { cause: error2 });
  }
}
function serverCounter(report, name) {
  const value = report.metadata.serverScan[name];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function impactSummary(report) {
  const client = report.metadata.clientCollection;
  const lines = [
    "## Alconite Impact",
    "",
    markdownTable(
      ["Detected risk", "Potential risk", "Breaking changes", "Affected files", "Affected locations", "Truncated"],
      [[
        report.overallRisk,
        report.overallPotentialRisk,
        report.breakingChanges,
        report.affectedFiles,
        report.affectedSourceLocations,
        report.metadata.truncated ? "yes" : "no"
      ]]
    ),
    "",
    "### Source accounting",
    "",
    markdownTable(
      ["Layer", "Visited", "Discovered", "Submitted / accepted", "Scanned", "Skipped"],
      [
        [
          "Runner collection",
          typeof client?.entriesVisited === "number" ? client.entriesVisited : "—",
          typeof client?.filesDiscovered === "number" ? client.filesDiscovered : "—",
          typeof client?.filesSubmitted === "number" ? client.filesSubmitted : "—",
          "—",
          typeof client?.filesSkipped === "number" ? client.filesSkipped : "—"
        ],
        [
          "Authoritative server scan",
          "—",
          "—",
          serverCounter(report, "filesAccepted"),
          serverCounter(report, "filesScanned"),
          serverCounter(report, "filesSkipped")
        ]
      ]
    ),
    ""
  ];
  const locations = report.changes.flatMap((change) => change.affectedSources.map((source) => ({ change, source })));
  if (locations.length > 0) {
    lines.push(
      "### Strongest returned evidence",
      "",
      markdownTable(
        ["Change", "Source", "Confidence", "Evidence"],
        locations.slice(0, 25).map(({ change, source }) => [
          change.kind,
          `${source.file}:${source.line}:${source.column}`,
          source.confidence,
          source.evidence.map((evidence) => `${evidence.type}=${evidence.value}`).join(", ")
        ])
      ),
      ""
    );
    if (locations.length > 25) lines.push(`_Showing 25 of ${locations.length} returned affected locations._`, "");
  }
  if (report.metadata.truncated) {
    lines.push(
      `_${report.metadata.returnedAffectedSourceLocations} of ${report.metadata.totalAffectedSourceLocations} affected locations were returned by the bounded report profile._`,
      ""
    );
  }
  return `${lines.join("\n")}
`;
}

// src/impact/source-manifest.ts
var import_node_perf_hooks2 = require("node:perf_hooks");
var import_node_path3 = __toESM(require("node:path"));
var import_ignore = __toESM(require_ignore());
var DEFAULT_SOURCE_COLLECTION_LIMITS = {
  maximumEntriesVisited: 2e4,
  maximumDirectoriesVisited: 5e3,
  maximumGitignoreFiles: 128,
  maximumGitignoreBytes: 512 * 1024,
  maximumGitignorePatterns: 1e4,
  maximumSubmittedFiles: 2e3,
  maximumManifestEntries: 2500,
  maximumFileBytes: 512 * 1024,
  maximumTotalSourceBytes: 16 * 1024 * 1024,
  maximumPathBytes: 512,
  maximumDepth: 32
};
var FIXED_DIRECTORIES = /* @__PURE__ */ new Set(["target", "node_modules", "dist", "build", ".gradle", ".idea", ".vscode", "coverage", "vendor"]);
var EXTENSIONS = /* @__PURE__ */ new Map([
  [".rs", "RUST"],
  [".java", "JAVA"],
  [".ts", "TYPESCRIPT"],
  [".tsx", "TYPESCRIPT"],
  [".js", "JAVASCRIPT"],
  [".jsx", "JAVASCRIPT"]
]);
function invalid(message) {
  throw new ImpactActionError("invalid_input", message);
}
function complexity(message) {
  throw new ImpactActionError("collection_limit_exceeded", message);
}
function validatePortableRoot(value) {
  const candidate = value.trim() || ".";
  if (Buffer.byteLength(candidate, "utf8") > 512 || candidate.includes("\0") || candidate.includes("\\") || candidate.startsWith("/") || /^[A-Za-z]:/u.test(candidate)) {
    invalid("source-root must be a portable path relative to GITHUB_WORKSPACE");
  }
  if (candidate === ".") return candidate;
  const components = candidate.split("/");
  if (components.some((component) => !component || component === "." || component === "..")) {
    invalid("source-root must contain only normalized path components below GITHUB_WORKSPACE");
  }
  return components.join("/");
}
function validateAdditionalIgnorePatterns(patterns) {
  if (patterns.length > 20) invalid("additional-ignore accepts at most 20 non-empty patterns");
  const result = [];
  for (const original of patterns) {
    const pattern = original.trim();
    if (!pattern) continue;
    const bytes = Buffer.byteLength(pattern, "utf8");
    if (bytes > 256 || pattern.startsWith("!") || pattern.startsWith("/") || pattern.includes("\\") || pattern.includes("\0") || pattern.split("/").some((component) => component === "..")) {
      invalid("additional-ignore contains an unsupported pattern; only bounded ignore-only workspace patterns are accepted");
    }
    result.push(pattern);
  }
  if (result.length > 20) invalid("additional-ignore accepts at most 20 non-empty patterns");
  return result;
}
function portable(workspace, filename) {
  return import_node_path3.default.relative(workspace, filename).split(import_node_path3.default.sep).join("/");
}
function pathDepth(root, filename) {
  const relative = import_node_path3.default.relative(root, filename);
  return relative ? relative.split(import_node_path3.default.sep).filter(Boolean).length : 0;
}
var CollectionAccounting = class {
  constructor(limits) {
    this.limits = limits;
  }
  limits;
  entriesVisited = 0;
  directoriesVisited = 0;
  gitignoreFiles = 0;
  gitignoreBytes = 0;
  gitignorePatterns = 0;
  filesDiscovered = 0;
  filesSubmitted = 0;
  filesSkipped = 0;
  totalSourceBytes = 0;
  skipCounts = /* @__PURE__ */ new Map();
  visitEntry() {
    this.entriesVisited += 1;
    if (this.entriesVisited > this.limits.maximumEntriesVisited) complexity("Source collection exceeded the entry-visit limit.");
  }
  remainingEntries() {
    return this.limits.maximumEntriesVisited - this.entriesVisited;
  }
  visitDirectory() {
    this.directoriesVisited += 1;
    if (this.directoriesVisited > this.limits.maximumDirectoriesVisited) complexity("Source collection exceeded the directory-visit limit.");
  }
  discoverFile() {
    this.filesDiscovered += 1;
  }
  skip(code) {
    this.filesSkipped += 1;
    this.skipCounts.set(code, (this.skipCounts.get(code) ?? 0) + 1);
  }
  submit(size) {
    if (this.filesSubmitted + 1 > this.limits.maximumSubmittedFiles || this.filesSubmitted + 1 > this.limits.maximumManifestEntries) {
      complexity("Source collection exceeded the submitted-file limit.");
    }
    if (this.totalSourceBytes + size > this.limits.maximumTotalSourceBytes) {
      complexity("Source collection exceeded the aggregate source-byte limit.");
    }
    this.filesSubmitted += 1;
    this.totalSourceBytes += size;
  }
  countGitignore(bytes, patterns) {
    this.gitignoreFiles += 1;
    this.gitignoreBytes += bytes;
    this.gitignorePatterns += patterns;
    if (this.gitignoreFiles > this.limits.maximumGitignoreFiles || this.gitignoreBytes > this.limits.maximumGitignoreBytes || this.gitignorePatterns > this.limits.maximumGitignorePatterns) complexity("Source collection exceeded the .gitignore complexity limit.");
  }
  metadata(duration) {
    if (this.filesDiscovered !== this.filesSubmitted + this.filesSkipped) {
      throw new ImpactActionError("source_race_detected", "Source collection accounting became inconsistent.");
    }
    const skipCounts = {};
    for (const code of SKIP_CODES) {
      const count = this.skipCounts.get(code);
      if (count) skipCounts[code] = count;
    }
    return {
      schemaVersion: CLIENT_COLLECTION_SCHEMA_VERSION,
      entriesVisited: this.entriesVisited,
      directoriesVisited: this.directoriesVisited,
      filesDiscovered: this.filesDiscovered,
      filesSubmitted: this.filesSubmitted,
      filesSkipped: this.filesSkipped,
      skipCounts,
      collectionDurationMs: Math.max(0, Math.floor(duration))
    };
  }
};
function meaningfulPatternCount(contents) {
  let count = 0;
  for (const line of contents.split(/\r?\n/u)) {
    if (!line || line.startsWith("#") && !line.startsWith("\\#")) continue;
    count += 1;
  }
  return count;
}
async function addGitignore(directory, workspace, layers, accounting, limits, deadline, hooks) {
  deadline.throwIfExpired();
  const filename = import_node_path3.default.join(directory, ".gitignore");
  let stats;
  try {
    stats = await inspectEntry(filename);
  } catch (error2) {
    const code = error2.code;
    if (code === "ENOENT") return;
    throw new ImpactActionError("source_file_read_failed", "A repository .gitignore could not be inspected securely.", { cause: error2 });
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new ImpactActionError("source_race_detected", "A repository .gitignore is a link or is not a regular file.");
  }
  const size = Number(stats.size);
  if (!Number.isSafeInteger(size) || size > limits.maximumGitignoreBytes - accounting.gitignoreBytes) {
    complexity("Source collection exceeded the .gitignore byte limit.");
  }
  const verified = await readVerifiedFile(filename, workspace, size, deadline, hooks);
  let contents;
  try {
    contents = new TextDecoder("utf-8", { fatal: true }).decode(verified.bytes);
  } catch (error2) {
    throw new ImpactActionError("source_file_read_failed", "A repository .gitignore is not valid UTF-8.", { cause: error2 });
  }
  const patternCount = meaningfulPatternCount(contents);
  accounting.countGitignore(verified.size, patternCount);
  let matcher;
  try {
    matcher = (0, import_ignore.default)().add(contents);
  } catch (error2) {
    throw new ImpactActionError("source_file_read_failed", "A repository .gitignore could not be parsed safely.", { cause: error2 });
  }
  layers.push({ base: portable(workspace.path, directory), matcher });
}
function ignoredByLayers(relativePath, isDirectory, layers) {
  let ignored;
  for (const layer of layers) {
    const fromBase = layer.base === "" ? relativePath : relativePath === layer.base ? "" : relativePath.startsWith(`${layer.base}/`) ? relativePath.slice(layer.base.length + 1) : void 0;
    if (!fromBase) continue;
    const result = layer.matcher.test(isDirectory ? `${fromBase}/` : fromBase);
    if (result.ignored) ignored = "GITIGNORE";
    if (result.unignored) ignored = void 0;
  }
  return ignored;
}
function ignoredByAdditional(relativeFromRoot, isDirectory, matcher) {
  if (!matcher || !relativeFromRoot) return false;
  return matcher.ignores(isDirectory ? `${relativeFromRoot}/` : relativeFromRoot);
}
function fixedIgnore(name, includeGeneratedDirectories) {
  return name === ".git" || !includeGeneratedDirectories && FIXED_DIRECTORIES.has(name);
}
function mergedLimits(overrides) {
  const limits = { ...DEFAULT_SOURCE_COLLECTION_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_SOURCE_COLLECTION_LIMITS[name]) {
      invalid(`The source collection limit ${name} is invalid.`);
    }
  }
  return limits;
}
async function collectSourceManifest(options) {
  const started = import_node_perf_hooks2.performance.now();
  options.deadline.throwIfExpired();
  const logicalRoot = validatePortableRoot(options.sourceRoot);
  const rootComponents = logicalRoot === "." ? [] : logicalRoot.split("/");
  if (rootComponents.includes(".git")) invalid("source-root cannot select the repository metadata directory");
  if (!options.includeGeneratedDirectories && rootComponents.some((component) => FIXED_DIRECTORIES.has(component))) {
    invalid("source-root selects a generated or vendor directory that is disabled by default");
  }
  const patterns = validateAdditionalIgnorePatterns(options.additionalIgnorePatterns);
  const limits = mergedLimits(options.limits);
  const hooks = options.hooks ?? {};
  const workspace = await verifyAbsoluteDirectory(import_node_path3.default.resolve(options.workspace), "source", options.deadline);
  const requestedRoot = logicalRoot === "." ? workspace.path : import_node_path3.default.resolve(workspace.path, ...logicalRoot.split("/"));
  const root = await verifyAbsoluteDirectory(requestedRoot, "source", options.deadline);
  if (!isContained(workspace.realPath, root.realPath)) invalid("source-root must remain inside GITHUB_WORKSPACE");
  const accounting = new CollectionAccounting(limits);
  const layers = [];
  const files = [];
  const detected = /* @__PURE__ */ new Set();
  const additionalMatcher = patterns.length > 0 ? (0, import_ignore.default)().add(patterns) : void 0;
  const relativeRoot = import_node_path3.default.relative(workspace.path, root.path);
  const ancestorParts = relativeRoot ? relativeRoot.split(import_node_path3.default.sep) : [];
  let ancestor = workspace.path;
  for (let index = 0; index < ancestorParts.length; index += 1) {
    await addGitignore(ancestor, workspace, layers, accounting, limits, options.deadline, hooks);
    const part = ancestorParts[index];
    if (part !== void 0) ancestor = import_node_path3.default.join(ancestor, part);
  }
  const walk = async (directory) => {
    options.deadline.throwIfExpired();
    accounting.visitDirectory();
    const entries = await readVerifiedDirectory(directory, workspace, options.deadline, hooks, accounting.remainingEntries());
    await addGitignore(directory, workspace, layers, accounting, limits, options.deadline, hooks);
    for (const entry of entries) {
      options.deadline.throwIfExpired();
      accounting.visitEntry();
      if (entry.name === ".gitignore") continue;
      const absolute = import_node_path3.default.join(directory, entry.name);
      const relativeWorkspace = portable(workspace.path, absolute);
      const relativeSource = portable(root.path, absolute);
      const depth = pathDepth(root.path, absolute);
      const pathTooLong = Buffer.byteLength(relativeWorkspace, "utf8") > limits.maximumPathBytes;
      const stats = await inspectEntry(absolute).catch((error2) => {
        throw new ImpactActionError("source_file_read_failed", "A source entry could not be inspected securely.", { cause: error2 });
      });
      const isDirectory = stats.isDirectory() && !stats.isSymbolicLink();
      if (stats.isSymbolicLink()) {
        accounting.discoverFile();
        accounting.skip("SYMLINK_OR_REPARSE");
        continue;
      }
      if (fixedIgnore(entry.name, options.includeGeneratedDirectories)) {
        if (!isDirectory) {
          accounting.discoverFile();
          accounting.skip("FIXED_IGNORE");
        }
        continue;
      }
      const ignored = ignoredByLayers(relativeWorkspace, isDirectory, layers);
      if (ignored) {
        if (!isDirectory) {
          accounting.discoverFile();
          accounting.skip(ignored);
        }
        continue;
      }
      if (ignoredByAdditional(relativeSource, isDirectory, additionalMatcher)) {
        if (!isDirectory) {
          accounting.discoverFile();
          accounting.skip("ADDITIONAL_IGNORE");
        }
        continue;
      }
      if (pathTooLong) {
        if (!isDirectory) {
          accounting.discoverFile();
          accounting.skip("PATH_TOO_LONG");
        }
        continue;
      }
      if (depth > limits.maximumDepth) {
        if (!isDirectory) {
          accounting.discoverFile();
          accounting.skip("DEPTH_EXCEEDED");
        }
        continue;
      }
      if (isDirectory) {
        await walk(absolute);
        continue;
      }
      accounting.discoverFile();
      if (!stats.isFile()) {
        accounting.skip("SYMLINK_OR_REPARSE");
        continue;
      }
      const language = EXTENSIONS.get(import_node_path3.default.extname(entry.name).toLowerCase());
      if (!language) {
        accounting.skip("UNSUPPORTED_FILE");
        continue;
      }
      const size = Number(stats.size);
      if (!Number.isSafeInteger(size) || size > limits.maximumFileBytes) {
        accounting.skip("FILE_TOO_LARGE");
        continue;
      }
      const verified = await readVerifiedFile(absolute, workspace, limits.maximumFileBytes, options.deadline, hooks);
      if (verified.bytes.includes(0)) {
        accounting.skip("BINARY_FILE");
        continue;
      }
      let content;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(verified.bytes);
      } catch {
        accounting.skip("INVALID_UTF8");
        continue;
      }
      accounting.submit(verified.size);
      detected.add(language);
      files.push({ path: relativeWorkspace, content });
    }
  };
  await walk(root.path);
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const languages = SOURCE_LANGUAGES.filter((language) => detected.has(language));
  return {
    logicalRoot,
    files,
    clientCollection: accounting.metadata(import_node_perf_hooks2.performance.now() - started),
    languages
  };
}

// src/impact/index.ts
function boundedInteger(value, name, minimum, maximum) {
  if (!/^\d+$/u.test(value.trim())) {
    throw new ImpactActionError("invalid_input", `${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ImpactActionError("invalid_input", `${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}
function booleanInput(value, name) {
  const normalized = value.trim().toLowerCase();
  if (normalized !== "true" && normalized !== "false") {
    throw new ImpactActionError("invalid_input", `${name} must be true or false.`);
  }
  return normalized === "true";
}
function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new ImpactActionError("invalid_input", `${name} must identify an existing runner directory.`);
  return value;
}
function assertClientAccountingEcho(expected, actual) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    throw new ImpactActionError("platform_contract_mismatch", "Alconite omitted the non-authoritative client collection accounting.");
  }
  const value = actual;
  for (const key of [
    "entriesVisited",
    "directoriesVisited",
    "filesDiscovered",
    "filesSubmitted",
    "filesSkipped",
    "collectionDurationMs"
  ]) {
    if (value[key] !== expected[key]) {
      throw new ImpactActionError("platform_contract_mismatch", "Alconite changed the submitted client collection accounting.");
    }
  }
  if (value.schemaVersion !== CLIENT_COLLECTION_SCHEMA_VERSION || value.authoritative !== false) {
    throw new ImpactActionError("platform_contract_mismatch", "Alconite returned invalid client collection metadata.");
  }
  if (!value.skipCounts || typeof value.skipCounts !== "object" || Array.isArray(value.skipCounts)) {
    throw new ImpactActionError("platform_contract_mismatch", "Alconite changed the submitted client skip accounting.");
  }
  const actualSkip = value.skipCounts;
  if (Object.keys(actualSkip).some((key) => !SKIP_CODES.includes(key)) || SKIP_CODES.some((code) => actualSkip[code] !== expected.skipCounts[code])) {
    throw new ImpactActionError("platform_contract_mismatch", "Alconite changed the submitted client skip accounting.");
  }
}
async function main() {
  const timeoutMs = boundedInteger(getInput("timeout-seconds"), "timeout-seconds", 1, 600) * 1e3;
  const deadline = new ActionDeadline(timeoutMs);
  const rawToken = getInput("project-token", { required: true });
  setSecret(rawToken);
  const projectToken = validateProjectToken(rawToken);
  const projectId = validateProjectId(getInput("project-id", { required: true }));
  const checkId = validateCheckId(getInput("check-id", { required: true }));
  const apiUrl = validateApiUrl(getInput("api-url"));
  const sourceRoot = validatePortableRoot(getInput("source-root"));
  const includeGeneratedDirectories = booleanInput(getInput("include-generated-directories"), "include-generated-directories");
  const additionalIgnorePatterns = validateAdditionalIgnorePatterns(getInput("additional-ignore").split(/\r?\n/u));
  const attempts = boundedInteger(getInput("attempts"), "attempts", 1, 5);
  const failOnRisk = parseRiskThreshold(getInput("fail-on-risk"), "fail-on-risk");
  const failOnPotentialRisk = parseRiskThreshold(getInput("fail-on-potential-risk"), "fail-on-potential-risk");
  const workspace = requiredEnvironment("GITHUB_WORKSPACE");
  const runnerTemp = requiredEnvironment("RUNNER_TEMP");
  const collection = await collectSourceManifest({
    workspace,
    sourceRoot,
    includeGeneratedDirectories,
    additionalIgnorePatterns,
    deadline
  });
  if (collection.files.length === 0) {
    throw new ImpactActionError("invalid_input", "No supported UTF-8 Rust, Java, TypeScript, or JavaScript source files were collected.");
  }
  info(
    `Collected ${collection.clientCollection.filesSubmitted} bounded source files for Alconite Impact; ${collection.clientCollection.filesSkipped} entries were skipped locally.`
  );
  const request = {
    source: {
      logicalRoot: collection.logicalRoot,
      files: collection.files,
      clientCollection: collection.clientCollection
    },
    options: {
      languages: [...SOURCE_LANGUAGES],
      includeGeneratedDirectories,
      additionalIgnorePatterns
    }
  };
  const report = await new ImpactPlatformClient({
    apiUrl,
    projectId,
    projectToken,
    checkId,
    attempts,
    deadline
  }).analyze(request);
  assertClientAccountingEcho(collection.clientCollection, report.metadata.clientCollection);
  const reportPath = await writePrivateReport(report, runnerTemp, workspace, deadline);
  const server = report.metadata.serverScan;
  const serverNumber = (key) => String(typeof server[key] === "number" ? server[key] : 0);
  setOutput("check-id", checkId);
  setOutput("overall-risk", report.overallRisk);
  setOutput("overall-potential-risk", report.overallPotentialRisk);
  setOutput("breaking-changes", String(report.breakingChanges));
  setOutput("affected-files", String(report.affectedFiles));
  setOutput("affected-source-locations", String(report.affectedSourceLocations));
  setOutput("files-scanned", serverNumber("filesScanned"));
  setOutput("files-skipped", serverNumber("filesSkipped"));
  setOutput("client-entries-visited", String(collection.clientCollection.entriesVisited));
  setOutput("client-files-discovered", String(collection.clientCollection.filesDiscovered));
  setOutput("client-files-submitted", String(collection.clientCollection.filesSubmitted));
  setOutput("client-files-skipped", String(collection.clientCollection.filesSkipped));
  setOutput("report-path", reportPath);
  setOutput("report-truncated", String(report.metadata.truncated));
  setOutput("analysis-fingerprint", report.analysisFingerprint);
  writeJobSummary(impactSummary(report));
  const detectedGate = shouldFailRisk(report.overallRisk, failOnRisk);
  const potentialGate = shouldFailRisk(report.overallPotentialRisk, failOnPotentialRisk);
  if (detectedGate || potentialGate) {
    const reasons = [
      detectedGate ? `detected risk ${report.overallRisk} met fail-on-risk ${failOnRisk}` : void 0,
      potentialGate ? `potential risk ${report.overallPotentialRisk} met fail-on-potential-risk ${failOnPotentialRisk}` : void 0
    ].filter((value) => value !== void 0);
    setFailed(`Alconite Impact gate failed: ${reasons.join("; ")}.`);
  } else {
    info(`Alconite Impact completed with detected risk ${report.overallRisk} and potential risk ${report.overallPotentialRisk}.`);
  }
}
void main().catch((error2) => {
  if (error2 instanceof ImpactActionError || error2 instanceof Error && error2.name === "ImpactContractError") {
    setFailed(error2.message);
    return;
  }
  setFailed("Alconite Impact failed with an unexpected internal error.");
});
