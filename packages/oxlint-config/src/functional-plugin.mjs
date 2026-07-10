// In-house port of the eslint-plugin-functional rules this repo uses.
// The upstream plugin loads the TS 5/6 compiler API at import time (via
// ts-api-utils), which crashes under TypeScript 7 (Go-native, no JS compiler
// API), so these five purely syntactic rules are reimplemented against
// oxlint's ESLint-compatible JS-plugin API. Rule names, default semantics,
// and messages mirror upstream so existing inline disables keep working.

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

const enclosingFunction = (node) => {
  for (let current = node.parent; current; current = current.parent) {
    if (FUNCTION_TYPES.has(current.type)) return current;
  }
  return null;
};

// Only a try statement entered through its `try {}` block catches the throw;
// a throw inside `catch {}` / `finally {}` still rejects (mirrors upstream).
const enclosingTryStatement = (node) => {
  let child = node;
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "TryStatement" && current.block === child) return current;
    child = current;
  }
  return null;
};

const noLet = {
  create(context) {
    return {
      VariableDeclaration(node) {
        if (node.kind === "let") {
          context.report({ node, message: "Unexpected let, use const instead." });
        }
      },
    };
  },
};

const reportLoop = (context) => (node) => {
  context.report({ node, message: "Unexpected loop, use map or reduce instead." });
};

const noLoopStatements = {
  create(context) {
    const report = reportLoop(context);
    return {
      ForStatement: report,
      ForInStatement: report,
      ForOfStatement: report,
      WhileStatement: report,
      DoWhileStatement: report,
    };
  },
};

const noThrowStatements = {
  create(context) {
    return {
      ThrowStatement(node) {
        context.report({
          node,
          message: "Unexpected throw, throwing exceptions is not functional.",
        });
      },
    };
  },
};

const noTryStatements = {
  create(context) {
    return {
      TryStatement(node) {
        context.report({
          node,
          message: node.handler
            ? "Unexpected try-catch, this pattern is not functional."
            : "Unexpected try-finally, this pattern is not functional.",
        });
      },
    };
  },
};

const REJECT_MESSAGE = "Unexpected rejection, resolve an error instead.";

const isPromiseRejectCall = (node) =>
  node.callee.type === "MemberExpression" &&
  node.callee.object.type === "Identifier" &&
  node.callee.object.name === "Promise" &&
  node.callee.property.type === "Identifier" &&
  node.callee.property.name === "reject";

const isPromiseExecutorWithReject = (node) =>
  node.callee.type === "Identifier" &&
  node.callee.name === "Promise" &&
  node.arguments[0] !== undefined &&
  FUNCTION_TYPES.has(node.arguments[0].type) &&
  node.arguments[0].params.length === 2;

// A throw inside an async function rejects the returned promise — unless a
// try-catch in the same function intercepts it (mirrors upstream logic).
const isRejectingAsyncThrow = (node) => {
  const fn = enclosingFunction(node);
  if (fn?.async !== true) return false;
  const tryStatement = enclosingTryStatement(node);
  return (
    tryStatement === null || enclosingFunction(tryStatement) !== fn || tryStatement.handler === null
  );
};

const noPromiseReject = {
  create(context) {
    return {
      CallExpression(node) {
        if (isPromiseRejectCall(node)) {
          context.report({ node, message: REJECT_MESSAGE });
        }
      },
      NewExpression(node) {
        if (isPromiseExecutorWithReject(node)) {
          context.report({ node: node.arguments[0].params[1], message: REJECT_MESSAGE });
        }
      },
      ThrowStatement(node) {
        if (isRejectingAsyncThrow(node)) {
          context.report({ node, message: REJECT_MESSAGE });
        }
      },
    };
  },
};

export default {
  meta: { name: "functional" },
  rules: {
    "no-let": noLet,
    "no-loop-statements": noLoopStatements,
    "no-throw-statements": noThrowStatements,
    "no-try-statements": noTryStatements,
    "no-promise-reject": noPromiseReject,
  },
};
