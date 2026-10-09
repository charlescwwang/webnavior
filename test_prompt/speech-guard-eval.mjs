const API = 'https://degpxbdqfz.aikcitri.qzz.io/api/chat'
const MODEL = 'qwen3.5:4b'
const TIMEOUT_MS = 2000

const PROMPT = `
你是餐廳智慧點餐機的 Speech Guard。

根據 ASR 文字，只判斷目前這段語音應如何處理：

FORWARD：
內容完整，而且合理需要點餐 Agent 處理或回應。
包含點餐、加減餐、修改餐點、取消餐點、菜單詢問、推薦詢問，以及明確對點餐系統的合理互動。

IGNORE：
明顯不需要點餐系統處理。
包含同行者間對話、對其他人的指令、背景談話、與點餐完全無關的內容。

WAIT：
語句尚未完成。
包含斷句、停頓、改口、重複、話說到一半，或使用者仍在形成意圖。

UNCERTAIN：
可能需要點餐系統處理，但單靠目前文字無法安全判定。

規則：
- 不要因為出現餐點、吃、喝、數量等詞就直接 FORWARD。
- 不要替使用者補完沒說出的內容。
- 有明顯未完成跡象時優先 WAIT。
- 無法確定說話對象或意圖時使用 UNCERTAIN。
- 只輸出合法 JSON，不要解釋。

輸出：
{"action":"FORWARD|IGNORE|WAIT|UNCERTAIN"}
`.trim()

const TESTS = [
  ['我要一份蝦捲', 'FORWARD'],
  ['幫我加一杯紅茶', 'FORWARD'],
  ['蝦捲會辣嗎', 'FORWARD'],
  ['今天有什麼推薦的', 'FORWARD'],
  ['不要辣', 'FORWARD'],
  ['剛剛那個不要了', 'FORWARD'],
  ['幫我改成兩份', 'FORWARD'],
  ['有沒有不含牛肉的', 'FORWARD'],

  ['我今天好餓', 'UNCERTAIN'],
  ['這個看起來不錯', 'UNCERTAIN'],
  ['那個呢', 'UNCERTAIN'],
  ['這樣可以嗎', 'UNCERTAIN'],
  ['好像可以耶', 'UNCERTAIN'],
  ['我不知道吃什麼', 'FORWARD'],

  ['我要……', 'WAIT'],
  ['我要一份……呃', 'WAIT'],
  ['我要雞腿，不是，等一下', 'WAIT'],
  ['兩個……欸三個……', 'WAIT'],
  ['不要辣然後……算了', 'WAIT'],
  ['我想要那個叫……', 'WAIT'],
  ['那個那個……等一下', 'WAIT'],
  ['我、我想……', 'WAIT'],

  ['欸你先去坐', 'IGNORE'],
  ['你要吃什麼我幫你點', 'IGNORE'],
  ['等一下記得打給媽媽', 'IGNORE'],
  ['你幫我顧一下包包', 'IGNORE'],
  ['我等等要去便利商店', 'IGNORE'],
  ['阿彌陀佛', 'IGNORE'],
  ['南無阿彌陀佛善哉善哉', 'IGNORE'],
  ['今天股票又跌了', 'IGNORE'],
  ['哈哈哈哈哈哈', 'IGNORE'],
  ['幹嘛啦你很煩耶', 'IGNORE'],

  ['雞腿不要……欸你要吃嗎', 'UNCERTAIN'],
  ['阿彌陀……我要那個', 'WAIT'],
  ['不是啦我是跟他講', 'IGNORE'],
  ['我要一……喔不是不是', 'WAIT'],
  ['我要兩個你要不要也吃一個', 'UNCERTAIN'],
  ['蝦捲多少……欸你電話響了', 'UNCERTAIN'],
  ['紅茶不要冰然後……欸等我一下', 'WAIT'],
  ['我想吃那個叫什麼來著', 'UNCERTAIN'],
]

async function runTest(text) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  const start = performance.now()

  try {
    const response = await fetch(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: PROMPT,
          },
          {
            role: 'user',
            content: text,
          },
        ],
        think: false,
        stream: false,
        keep_alive: -1,
      }),
    })

    const elapsedMs = performance.now() - start

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    const content = data?.message?.content?.trim() ?? ''

    let action = 'INVALID'

    try {
      const parsed = JSON.parse(content)
      action = parsed.action ?? 'INVALID'
    } catch {
      action = 'INVALID'
    }

    return {
      action,
      elapsedMs,
      modelMs: data.total_duration
        ? data.total_duration / 1_000_000
        : null,
      raw: content,
    }
  } catch (error) {
    const elapsedMs = performance.now() - start

    if (error.name === 'AbortError') {
      return {
        action: 'TIMEOUT',
        elapsedMs,
        modelMs: null,
        raw: '',
      }
    }

    return {
      action: 'ERROR',
      elapsedMs,
      modelMs: null,
      raw: String(error),
    }
  } finally {
    clearTimeout(timeout)
  }
}

const results = []

for (let i = 0; i < TESTS.length; i++) {
  const [text, expected] = TESTS[i]

  const result = await runTest(text)
  const correct = result.action === expected

  results.push({
    text,
    expected,
    predicted: result.action,
    correct,
    elapsedMs: result.elapsedMs,
    modelMs: result.modelMs,
  })

  console.log('='.repeat(70))
  console.log(`[${String(i + 1).padStart(2, '0')}] ${text}`)
  console.log(`預期: ${expected}`)
  console.log(`結果: ${result.action}  [${correct ? 'OK' : 'XX'}]`)
  console.log(`HTTP: ${(result.elapsedMs / 1000).toFixed(3)} 秒`)

  if (result.modelMs != null) {
    console.log(`模型: ${result.modelMs.toFixed(1)} ms`)
  }

  if (['INVALID', 'ERROR'].includes(result.action)) {
    console.log(`RAW: ${result.raw}`)
  }
}

console.log('\n' + '='.repeat(70))
console.log('SUMMARY')
console.log('='.repeat(70))

const validResults = results.filter(
  r => !['TIMEOUT', 'ERROR', 'INVALID'].includes(r.predicted)
)

const correctCount = validResults.filter(r => r.correct).length
const accuracy = validResults.length
  ? (correctCount / validResults.length) * 100
  : 0

console.log(`總測試數: ${results.length}`)
console.log(`有效結果: ${validResults.length}`)
console.log(`正確: ${correctCount}`)
console.log(`Accuracy: ${accuracy.toFixed(1)}%`)

if (validResults.length) {
  const latencies = validResults.map(r => r.elapsedMs)

  const avg =
    latencies.reduce((sum, value) => sum + value, 0) / latencies.length

  console.log(`平均 HTTP latency: ${(avg / 1000).toFixed(3)} 秒`)
  console.log(
    `最快: ${(Math.min(...latencies) / 1000).toFixed(3)} 秒`
  )
  console.log(
    `最慢: ${(Math.max(...latencies) / 1000).toFixed(3)} 秒`
  )
}

const modelLatencies = validResults
  .map(r => r.modelMs)
  .filter(v => v != null)

if (modelLatencies.length) {
  const avgModel =
    modelLatencies.reduce((sum, value) => sum + value, 0) /
    modelLatencies.length

  console.log(`平均模型 latency: ${avgModel.toFixed(1)} ms`)
}

console.log('\n錯誤案例：')

const errors = results.filter(r => !r.correct)

if (!errors.length) {
  console.log('無')
} else {
  for (const r of errors) {
    console.log(
      `- ${r.text} | expected=${r.expected} | predicted=${r.predicted}`
    )
  }
}

console.log('\nFalse FORWARD：')

const falseForward = results.filter(
  r => r.predicted === 'FORWARD' && r.expected !== 'FORWARD'
)

if (!falseForward.length) {
  console.log('無')
} else {
  for (const r of falseForward) {
    console.log(`- ${r.text} | expected=${r.expected}`)
  }
}

console.log('\nPrediction distribution：')

const distribution = {}

for (const r of results) {
  distribution[r.predicted] = (distribution[r.predicted] ?? 0) + 1
}

for (const [label, count] of Object.entries(distribution)) {
  console.log(`${label}: ${count}`)
}
