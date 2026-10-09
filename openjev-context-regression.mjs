// openjev-context-regression.mjs
//
// Node.js 18+
//
// 執行：
//   node openjev-context-regression.mjs
//
// 自訂 endpoint：
//   OPENJEV_URL=http://127.0.0.1:5150/v1/systemone node openjev-context-regression.mjs

const ENDPOINT =
  process.env.OPENJEV_URL ||
  "https://openjev.aikcitri.qzz.io/v1/systemone";

// ============================================================
// OpenJev question
// ============================================================

const QUESTIONS = {
  route: {
    type: "choice",

    instructions: `
Classify the CURRENT user utterance based on the full conversation state.

The current utterance may be:
- a complete standalone request
- a follow-up answer
- a correction
- a self-repair
- speech directed to another person
- an incomplete utterance

Use:
- conversation_history
- current_user_utterance
- cart
- phase
- visible or referenced item

Do not assume every food-related sentence is directed to the kiosk.

Focus on the CURRENT user's communicative intent.
`.trim(),

    criteria: {
      order: `
The current utterance represents an ordering action or a meaningful response
inside an active ordering workflow.

Includes:
- ordering food
- adding items
- removing items
- changing quantity
- changing options
- confirming
- rejecting
- selecting payment
- answering an ordering question

Examples:
"我要一份蝦捲"
"改成兩份"
"不要辣"
"好"
"不用"

Context may be required to determine whether a short response belongs here.
`.trim(),

      menu_query: `
The current utterance asks for menu-related information.

Includes:
- price
- ingredients
- availability
- recommendations
- taste
- spicy level
- item differences
- follow-up questions about a referenced item

Examples:
"蝦捲會辣嗎"
"那這個呢"
`.trim(),

      small_talk: `
The utterance is intentionally directed toward the kiosk,
but is casual conversation rather than an ordering or menu request.

Examples:
"今天好累"
"你好"
"天氣好熱"
`.trim(),

      background: `
The utterance is not meaningfully directed toward the kiosk.

Includes:
- talking to another person
- side conversation
- asking a companion what they want
- unrelated nearby speech

Example:
"你要吃什麼我幫你點"
when the user is clearly talking to a companion.
`.trim(),

      ambiguous: `
The intended meaning cannot yet be reliably determined.

Includes:
- unfinished speech
- unresolved self-correction
- unclear referent
- unclear addressee
- contradictory or incomplete intent

Examples:
"我要那個……"
"雞腿不要……欸"
"不是，我是說……"
`.trim(),
    },
  },
};

// ============================================================
// Regression cases
// ============================================================

const TESTS = [
  // ==========================================================
  // 1. 指涉依賴
  // ==========================================================

  {
    id: "R01-A",
    pair: "那個呢",
    mode: "standalone",
    current: "那個呢",
    expected: "ambiguous",
  },

  {
    id: "R01-B",
    pair: "那個呢",
    mode: "context",
    history: [
      {
        role: "user",
        content: "蝦捲會辣嗎？",
      },
      {
        role: "assistant",
        content: "蝦捲不辣，旁邊的黃金泡菜是微辣。",
      },
    ],
    visibleItem: "黃金泡菜",
    current: "那個呢",
    expected: "menu_query",
  },

  // ==========================================================
  // 2. 弱肯定
  // ==========================================================

  {
    id: "R02-A",
    pair: "好像可以耶",
    mode: "standalone",
    current: "好像可以耶",
    expected: "ambiguous",
  },

  {
    id: "R02-B",
    pair: "好像可以耶",
    mode: "context",
    history: [
      {
        role: "user",
        content: "我要一份蝦捲",
      },
      {
        role: "assistant",
        content: "要不要再加一杯紅茶？",
      },
    ],
    current: "好像可以耶",
    expected: "order",
  },

  // ==========================================================
  // 3. 自我修正 / 放棄操作
  // ==========================================================

  {
    id: "R03-A",
    pair: "不要辣然後算了",
    mode: "standalone",
    current: "不要辣然後……算了",
    expected: "ambiguous",
  },

  {
    id: "R03-B",
    pair: "不要辣然後算了",
    mode: "context",
    history: [
      {
        role: "user",
        content: "我要一份炸雞",
      },
      {
        role: "assistant",
        content: "炸雞可以選辣或不辣。",
      },
    ],
    cart: [
      {
        item: "炸雞",
        qty: 1,
        spicy: null,
      },
    ],
    current: "不要辣然後……算了",
    expected: "ambiguous",
  },

  // ==========================================================
  // 4. 對旁人說話
  // ==========================================================

  {
    id: "R04-A",
    pair: "你要吃什麼我幫你點",
    mode: "standalone",
    current: "你要吃什麼我幫你點",
    expected: "background",
  },

  {
    id: "R04-B",
    pair: "你要吃什麼我幫你點",
    mode: "context",
    history: [
      {
        role: "assistant",
        content: "請問今天想吃什麼？",
      },
      {
        role: "user",
        content: "等一下，我問我朋友。",
      },
    ],
    current: "你要吃什麼我幫你點",
    expected: "background",
  },

  // ==========================================================
  // 5. 中途轉向旁人
  // ==========================================================

  {
    id: "R05-A",
    pair: "雞腿不要欸你要吃嗎",
    mode: "standalone",
    current: "雞腿不要……欸你要吃嗎",
    expected: "ambiguous",
  },

  {
    id: "R05-B",
    pair: "雞腿不要欸你要吃嗎",
    mode: "context",
    history: [
      {
        role: "user",
        content: "我要雞腿便當",
      },
      {
        role: "assistant",
        content: "好的，一份雞腿便當。",
      },
    ],
    cart: [
      {
        item: "雞腿便當",
        qty: 1,
      },
    ],
    current: "雞腿不要……欸你要吃嗎",
    expected: "ambiguous",
  },

  // ==========================================================
  // 6. 前半無意義，後半有訂餐意圖但 target 不明
  // ==========================================================

  {
    id: "R06-A",
    pair: "阿彌陀我要那個",
    mode: "standalone",
    current: "阿彌陀……我要那個",
    expected: "ambiguous",
  },

  {
    id: "R06-B",
    pair: "阿彌陀我要那個",
    mode: "context",
    history: [
      {
        role: "assistant",
        content: "目前畫面上有蝦捲、魚丸湯和紅茶。",
      },
    ],
    current: "阿彌陀……我要那個",
    expected: "ambiguous",
  },

  // ==========================================================
  // 7. 訂單 + 對旁人詢問混合
  // ==========================================================

  {
    id: "R07-A",
    pair: "我要兩個你要不要也吃一個",
    mode: "standalone",
    current: "我要兩個你要不要也吃一個",
    expected: "ambiguous",
  },

  {
    id: "R07-B",
    pair: "我要兩個你要不要也吃一個",
    mode: "context",
    history: [
      {
        role: "user",
        content: "我要蝦捲",
      },
      {
        role: "assistant",
        content: "蝦捲要幾份？",
      },
    ],
    current: "我要兩個你要不要也吃一個",
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

  if (test.cart) {
    state.cart = test.cart;
  }

  if (test.phase) {
    state.phase = test.phase;
  }

  if (test.visibleItem) {
    state.currently_referenced_or_visible_item = test.visibleItem;
  }

  return JSON.stringify(state, null, 2);
}

// ============================================================
// API
// ============================================================

async function askOpenJev(test) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      state: buildState(test),
      questions: QUESTIONS,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `HTTP ${response.status} ${response.statusText}\n${text}`
    );
  }

  return response.json();
}

// ============================================================
// Helpers
// ============================================================

function confidenceText(value) {
  if (typeof value !== "number") {
    return "N/A";
  }

  return value.toFixed(4);
}

function percentage(value, total) {
  if (!total) {
    return "N/A";
  }

  return `${((value / total) * 100).toFixed(1)}%`;
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log(`OpenJev endpoint: ${ENDPOINT}`);
  console.log(`Regression cases: ${TESTS.length}`);
  console.log("");

  const results = [];

  for (const test of TESTS) {
    console.log("=".repeat(72));
    console.log(
      `[${test.id}] ${test.mode.toUpperCase()} | "${test.current}"`
    );

    if (test.history?.length) {
      console.log("History:");

      for (const msg of test.history) {
        console.log(`  ${msg.role}: ${msg.content}`);
      }
    }

    try {
      const started = performance.now();

      const data = await askOpenJev(test);

      const latency = performance.now() - started;

      const answer = data?.answers?.route;

      const actual = answer?.choice;

      const ok = actual === test.expected;

      console.log(`Expected   : ${test.expected}`);
      console.log(`Actual     : ${actual}`);
      console.log(
        `Confidence : ${confidenceText(answer?.confidence)}`
      );
      console.log(`Latency    : ${latency.toFixed(0)} ms`);
      console.log(`Result     : ${ok ? "OK" : "XX"}`);

      if (answer?.probabilities) {
        const sorted = Object.entries(
          answer.probabilities
        ).sort((a, b) => Number(b[1]) - Number(a[1]));

        console.log(
          "Probability:",
          sorted
            .map(
              ([name, value]) =>
                `${name}=${Number(value).toFixed(4)}`
            )
            .join("  ")
        );
      }

      results.push({
        test,
        actual,
        ok,
        confidence: answer?.confidence,
      });
    } catch (error) {
      console.error(`ERROR: ${error.message}`);
    }
  }

  // ==========================================================
  // Summary
  // ==========================================================

  console.log("\n");
  console.log("=".repeat(72));
  console.log("SUMMARY");
  console.log("=".repeat(72));

  const standalone = results.filter(
    (x) => x.test.mode === "standalone"
  );

  const context = results.filter(
    (x) => x.test.mode === "context"
  );

  const standaloneOK = standalone.filter(
    (x) => x.ok
  ).length;

  const contextOK = context.filter(
    (x) => x.ok
  ).length;

  console.log(
    `Standalone : ${standaloneOK}/${standalone.length} ` +
      `accuracy=${percentage(standaloneOK, standalone.length)}`
  );

  console.log(
    `Context    : ${contextOK}/${context.length} ` +
      `accuracy=${percentage(contextOK, context.length)}`
  );

  // ==========================================================
  // Pair comparison
  // ==========================================================

  console.log("\n");
  console.log("=".repeat(72));
  console.log("CONTEXT REGRESSION");
  console.log("=".repeat(72));

  const pairs = [
    ...new Set(
      results
        .map((x) => x.test.pair)
        .filter(Boolean)
    ),
  ];

  let improved = 0;
  let unchangedCorrect = 0;
  let unchangedWrong = 0;
  let regressed = 0;

  for (const pair of pairs) {
    const rows = results.filter(
      (x) => x.test.pair === pair
    );

    const a = rows.find(
      (x) => x.test.mode === "standalone"
    );

    const b = rows.find(
      (x) => x.test.mode === "context"
    );

    if (!a || !b) {
      continue;
    }

    let status;

    if (!a.ok && b.ok) {
      status = "IMPROVED";
      improved++;
    } else if (a.ok && b.ok) {
      status = "CORRECT BOTH";
      unchangedCorrect++;
    } else if (!a.ok && !b.ok) {
      status = "WRONG BOTH";
      unchangedWrong++;
    } else {
      status = "REGRESSED";
      regressed++;
    }

    console.log(`\n[${pair}]`);

    console.log(
      `  standalone : ${a.actual} ` +
        `(expected ${a.test.expected}) ` +
        `${a.ok ? "[OK]" : "[XX]"}`
    );

    console.log(
      `  context    : ${b.actual} ` +
        `(expected ${b.test.expected}) ` +
        `${b.ok ? "[OK]" : "[XX]"}`
    );

    console.log(`  result     : ${status}`);
  }

  console.log("\n");
  console.log("=".repeat(72));
  console.log("REGRESSION RESULT");
  console.log("=".repeat(72));

  console.log(`Improved     : ${improved}`);
  console.log(`Correct both : ${unchangedCorrect}`);
  console.log(`Wrong both   : ${unchangedWrong}`);
  console.log(`Regressed    : ${regressed}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});