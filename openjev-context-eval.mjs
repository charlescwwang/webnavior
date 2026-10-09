// openjev-context-eval.mjs
//
// Node.js 18+
//
// 執行：
//   node openjev-context-eval.mjs
//
// 自訂 endpoint：
//   OPENJEV_URL=http://127.0.0.1:5150/v1/systemone node openjev-context-eval.mjs

const ENDPOINT =
  process.env.OPENJEV_URL ||
  "https://openjev.aikcitri.qzz.io/v1/systemone";

// ============================================================
// OpenJev question definition
// ============================================================

const QUESTIONS = {
  route: {
    type: "choice",

    instructions: `
Classify the CURRENT user utterance based on the full conversation state.

Do NOT classify only from the literal current sentence.

Use all available information in the state, including:
- conversation_history
- current_user_utterance
- cart
- phase
- currently_referenced_or_visible_item

The CURRENT utterance may be only one turn in an ongoing ordering conversation.

Examples:

Assistant: 蝦捲要幾份？
User: 兩份
=> order

Assistant: 要不要辣？
User: 不要辣
=> order

Assistant: 要確認送出訂單嗎？
User: 好
=> order

Assistant: 要使用信用卡還是行動支付？
User: 信用卡
=> order

But:

User: 兩份
with no relevant context
=> ambiguous

User: 好
with no relevant context
=> ambiguous

User: 不用
with no relevant context
=> ambiguous
`.trim(),

    criteria: {
      order: `
The current utterance belongs to an ordering workflow.

This includes:
- ordering an item
- adding an item
- changing quantity
- changing item options
- removing or cancelling an item
- replacing an item
- answering a quantity question
- answering an option question
- confirming an order
- rejecting an order
- choosing a payment method
- responding to an ordering-related assistant question

The utterance may be very short if its meaning becomes clear from conversation history.

Examples:
"我要一份蝦捲"
"幫我加一杯紅茶"
"改成兩份"
"不要辣"
"不用"
"好"
"信用卡"

Short utterances should only be classified as order when the conversation
history or structured state makes their ordering meaning clear.
`.trim(),

      menu_query: `
The user is asking for menu information.

Examples include:
- price
- ingredients
- spicy or not
- recommendation
- availability
- item differences
- portion size
- menu options
- taste
- contents of a meal

This also includes short follow-up questions when their meaning becomes
clear from conversation history.

Examples:
"蝦捲會辣嗎"
"今天有什麼推薦的"
"這個多少錢"
"那這個呢"
`.trim(),

      small_talk: `
Conversation directed toward the kiosk but not requesting menu information
and not performing an ordering action.

Examples:
"今天好累"
"我今天好餓"
"天氣好熱"
"你好"
`.trim(),

      background: `
Speech that is not directed toward the kiosk.

Examples:
- talking to another person
- unrelated nearby conversation
- environmental speech
- speech clearly not intended as an interaction with the kiosk
`.trim(),

      ambiguous: `
The intended meaning cannot be determined reliably even after considering
all available conversation history and structured state.

Use this when the utterance is incomplete, underspecified, or lacks enough
context to determine a reliable action.

Examples:
"兩份" with no relevant previous conversation
"好" with no relevant previous conversation
"不用" with no relevant previous conversation
"不要了" with no identifiable target
"那個" when there is no identifiable referent
`.trim(),
    },
  },
};

// ============================================================
// Test cases
// ============================================================

const TESTS = [
  // ----------------------------------------------------------
  // 基本單句
  // ----------------------------------------------------------

  {
    id: "S01",
    mode: "standalone",
    current: "我要一份蝦捲",
    expected: "order",
  },

  {
    id: "S02",
    mode: "standalone",
    current: "蝦捲會辣嗎",
    expected: "menu_query",
  },

  {
    id: "S03",
    mode: "standalone",
    current: "今天好累喔",
    expected: "small_talk",
  },

  // ==========================================================
  // Pair 1：兩份
  // ==========================================================

  {
    id: "P01-A",
    pair: "兩份",
    mode: "standalone",
    current: "兩份",
    expected: "ambiguous",
  },

  {
    id: "P01-B",
    pair: "兩份",
    mode: "context",
    history: [
      {
        role: "user",
        content: "我要蝦捲",
      },
      {
        role: "assistant",
        content: "好的，蝦捲要幾份？",
      },
    ],
    current: "兩份",
    expected: "order",
  },

  // ==========================================================
  // Pair 2：不要辣
  // ==========================================================

  {
    id: "P02-A",
    pair: "不要辣",
    mode: "standalone",
    current: "不要辣",
    expected: "ambiguous",
  },

  {
    id: "P02-B",
    pair: "不要辣",
    mode: "context",
    history: [
      {
        role: "user",
        content: "我要一份炸雞",
      },
      {
        role: "assistant",
        content: "炸雞可以選辣或不辣，請問要哪一種？",
      },
    ],
    current: "不要辣",
    expected: "order",
  },

  // ==========================================================
  // Pair 3：好
  // ==========================================================

  {
    id: "P03-A",
    pair: "好",
    mode: "standalone",
    current: "好",
    expected: "ambiguous",
  },

  {
    id: "P03-B",
    pair: "好",
    mode: "context",
    history: [
      {
        role: "assistant",
        content: "目前是一份蝦捲和一杯紅茶，要確認送出訂單嗎？",
      },
    ],
    cart: [
      {
        item: "蝦捲",
        qty: 1,
      },
      {
        item: "紅茶",
        qty: 1,
      },
    ],
    phase: "order_confirmation",
    current: "好",
    expected: "order",
  },

  // ==========================================================
  // Pair 4：不要了
  // ==========================================================

  {
    id: "P04-A",
    pair: "不要了",
    mode: "standalone",
    current: "不要了",
    expected: "ambiguous",
  },

  {
    id: "P04-B",
    pair: "不要了",
    mode: "context",
    history: [
      {
        role: "user",
        content: "再加一杯紅茶",
      },
      {
        role: "assistant",
        content: "好的，已加入一杯紅茶。",
      },
    ],
    cart: [
      {
        item: "蝦捲",
        qty: 1,
      },
      {
        item: "紅茶",
        qty: 1,
      },
    ],
    current: "不要了",
    expected: "order",
  },

  // ==========================================================
  // Pair 5：改成兩份
  // ==========================================================

  {
    id: "P05-A",
    pair: "改成兩份",
    mode: "standalone",
    current: "改成兩份",
    expected: "ambiguous",
  },

  {
    id: "P05-B",
    pair: "改成兩份",
    mode: "context",
    history: [
      {
        role: "user",
        content: "我要一份蝦捲",
      },
      {
        role: "assistant",
        content: "好的，一份蝦捲。",
      },
    ],
    cart: [
      {
        item: "蝦捲",
        qty: 1,
      },
    ],
    current: "改成兩份",
    expected: "order",
  },

  // ==========================================================
  // Pair 6：信用卡
  // ==========================================================

  {
    id: "P06-A",
    pair: "信用卡",
    mode: "standalone",
    current: "信用卡",
    expected: "ambiguous",
  },

  {
    id: "P06-B",
    pair: "信用卡",
    mode: "context",
    history: [
      {
        role: "assistant",
        content: "請問要使用信用卡還是行動支付？",
      },
    ],
    phase: "payment_method",
    current: "信用卡",
    expected: "order",
  },

  // ==========================================================
  // Pair 7：那這個呢？
  // ==========================================================

  {
    id: "P07-A",
    pair: "那這個呢",
    mode: "standalone",
    current: "那這個呢？",
    expected: "ambiguous",
  },

  {
    id: "P07-B",
    pair: "那這個呢",
    mode: "context",
    history: [
      {
        role: "user",
        content: "蝦捲會辣嗎？",
      },
      {
        role: "assistant",
        content: "蝦捲本身不辣。旁邊這款黃金泡菜有微辣。",
      },
    ],
    visibleItem: "黃金泡菜",
    current: "那這個呢？",
    expected: "menu_query",
  },

  // ==========================================================
  // Pair 8：不用
  // ==========================================================

  {
    id: "P08-A",
    pair: "不用",
    mode: "standalone",
    current: "不用",
    expected: "ambiguous",
  },

  {
    id: "P08-B",
    pair: "不用",
    mode: "context",
    history: [
      {
        role: "user",
        content: "我要一份蝦捲",
      },
      {
        role: "assistant",
        content: "需要再加購飲料嗎？",
      },
    ],
    current: "不用",
    expected: "order",
  },
];

// ============================================================
// Build state
// ============================================================

function buildState(test) {
  const state = {
    conversation_history: test.history || [],
    current_user_utterance: test.current,
  };

  if (test.phase) {
    state.phase = test.phase;
  }

  if (test.cart) {
    state.cart = test.cart;
  }

  if (test.visibleItem) {
    state.currently_referenced_or_visible_item = test.visibleItem;
  }

  return JSON.stringify(state, null, 2);
}

// ============================================================
// Call OpenJev
// ============================================================

async function askOpenJev(test) {
  const state = buildState(test);

  const body = {
    state,
    questions: QUESTIONS,
  };

  const started = performance.now();

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const latencyMs = performance.now() - started;

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `HTTP ${response.status} ${response.statusText}\n${text}`
    );
  }

  const data = await response.json();

  const route = data?.answers?.route;

  return {
    choice: route?.choice,
    confidence: route?.confidence,
    probabilities: route?.probabilities,
    latencyMs,
    raw: data,
    state,
  };
}

// ============================================================
// Helpers
// ============================================================

function pct(correct, total) {
  if (!total) {
    return "N/A";
  }

  return `${((correct / total) * 100).toFixed(1)}%`;
}

function formatConfidence(value) {
  if (typeof value !== "number") {
    return "N/A";
  }

  return value.toFixed(4);
}

// ============================================================
// Summary
// ============================================================

function printSummary(results) {
  console.log("\n");
  console.log("=".repeat(72));
  console.log("SUMMARY");
  console.log("=".repeat(72));

  const groups = {
    ALL: results,
    standalone: results.filter(
      (row) => row.test.mode === "standalone"
    ),
    context: results.filter(
      (row) => row.test.mode === "context"
    ),
  };

  for (const [name, rows] of Object.entries(groups)) {
    const correct = rows.filter((row) => row.ok).length;

    const avgLatency =
      rows.length > 0
        ? rows.reduce(
            (sum, row) => sum + row.result.latencyMs,
            0
          ) / rows.length
        : 0;

    console.log(
      `${name.padEnd(12)} ` +
        `${correct}/${rows.length} ` +
        `accuracy=${pct(correct, rows.length)} ` +
        `avg=${avgLatency.toFixed(0)}ms`
    );
  }

  // ----------------------------------------------------------
  // Context pair analysis
  // ----------------------------------------------------------

  console.log("\n");
  console.log("=".repeat(72));
  console.log("CONTEXT PAIR ANALYSIS");
  console.log("=".repeat(72));

  const pairNames = [
    ...new Set(
      results
        .map((row) => row.test.pair)
        .filter(Boolean)
    ),
  ];

  for (const pair of pairNames) {
    const pairRows = results.filter(
      (row) => row.test.pair === pair
    );

    const standalone = pairRows.find(
      (row) => row.test.mode === "standalone"
    );

    const context = pairRows.find(
      (row) => row.test.mode === "context"
    );

    if (!standalone || !context) {
      continue;
    }

    const changed =
      standalone.result.choice !== context.result.choice;

    const pairCorrect =
      standalone.ok && context.ok;

    console.log(`\n[${pair}]`);

    console.log(
      `  no context : ${standalone.result.choice} ` +
        `(expected ${standalone.test.expected}) ` +
        `${standalone.ok ? "[OK]" : "[XX]"}`
    );

    console.log(
      `  context    : ${context.result.choice} ` +
        `(expected ${context.test.expected}) ` +
        `${context.ok ? "[OK]" : "[XX]"}`
    );

    console.log(
      `  changed    : ${changed ? "YES" : "NO"}`
    );

    console.log(
      `  pair result: ${pairCorrect ? "OK" : "XX"}`
    );
  }

  // ----------------------------------------------------------
  // Failed cases
  // ----------------------------------------------------------

  const failures = results.filter(
    (row) => !row.ok
  );

  console.log("\n");
  console.log("=".repeat(72));
  console.log(`FAILED CASES (${failures.length})`);
  console.log("=".repeat(72));

  if (!failures.length) {
    console.log("None");
    return;
  }

  for (const row of failures) {
    console.log(
      `${row.test.id}: "${row.test.current}" ` +
        `expected=${row.test.expected} ` +
        `actual=${row.result.choice} ` +
        `confidence=${formatConfidence(
          row.result.confidence
        )}`
    );
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log(`OpenJev endpoint: ${ENDPOINT}`);
  console.log(`Cases: ${TESTS.length}`);
  console.log("");

  const results = [];

  for (const test of TESTS) {
    console.log("-".repeat(72));

    console.log(
      `[${test.id}] ${test.mode.toUpperCase()} | "${test.current}"`
    );

    if (test.history?.length) {
      console.log("History:");

      for (const message of test.history) {
        console.log(
          `  ${message.role}: ${message.content}`
        );
      }
    }

    if (test.cart) {
      console.log(
        `Cart: ${JSON.stringify(test.cart)}`
      );
    }

    if (test.phase) {
      console.log(
        `Phase: ${test.phase}`
      );
    }

    if (test.visibleItem) {
      console.log(
        `Visible item: ${test.visibleItem}`
      );
    }

    try {
      const result = await askOpenJev(test);

      const ok =
        result.choice === test.expected;

      console.log(
        `Expected   : ${test.expected}`
      );

      console.log(
        `Actual     : ${result.choice}`
      );

      console.log(
        `Confidence : ${formatConfidence(
          result.confidence
        )}`
      );

      console.log(
        `Latency    : ${result.latencyMs.toFixed(
          0
        )} ms`
      );

      console.log(
        `Result     : ${ok ? "OK" : "XX"}`
      );

      if (result.probabilities) {
        const sorted = Object.entries(
          result.probabilities
        ).sort(
          (a, b) => Number(b[1]) - Number(a[1])
        );

        console.log(
          "Probability:",
          sorted
            .map(
              ([key, value]) =>
                `${key}=${Number(
                  value
                ).toFixed(4)}`
            )
            .join("  ")
        );
      }

      results.push({
        test,
        result,
        ok,
      });
    } catch (error) {
      console.error(
        `ERROR: ${error.message}`
      );
    }
  }

  printSummary(results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});