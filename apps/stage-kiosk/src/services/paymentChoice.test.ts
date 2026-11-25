import { expect, it } from 'vitest'

import { paymentChoiceFromSpeech, paymentOptionsReply, requestsPaymentReturn } from './paymentChoice'

it.each([
  ['我要用 Apple Pay', 'apple'],
  ['請幫我選綠界 Pay 付款', 'wallet'],
  ['自行輸入卡號', 'card'],
  ['信用卡自行輸入卡號', 'card'],
  ['刷卡', 'credit'],
  ['我想用 LINE Pay', 'line'],
  ['Apple Pay 還是綠界 Pay', undefined],
  ['不用 Apple Pay', undefined],
  ['可以用 Apple Pay 嗎？', undefined],
])('resolves only one explicit payment selection from %s', (text, choice) => {
  expect(paymentChoiceFromSpeech(text!)).toBe(choice)
})

it.each([
  ['我想改用 LINE Pay', 'line'],
  ['換成信用卡', 'credit'],
  ['幫我改刷卡', 'credit'],
  ['可以改成 Apple Pay 嗎？', undefined],
  ['我要換付款方式', undefined],
])('switches only to an explicitly requested method: %s', (text, choice) => {
  expect(paymentChoiceFromSpeech(text!)).toBe(choice)
})

it.each([
  ['返回上一頁', true],
  ['請幫我回到付款方式頁', true],
  ['回上一步', true],
  ['上一頁', true],
  ['回上一頁重新選', true],
  ['我想換個付款方式。', true],
  ['麻煩幫我回到選付款方式的畫面', true],
  ['我想重新選擇付款方式', true],
  ['退回去重選', true],
  ['這張卡刷不過', false],
  ['不要換付款方式', false],
  ['如果刷不過就回上一頁', false],
  ['還有別的付款方式嗎？', false],
  ['我不要這個，我想改用 LINE Pay', false],
  ['可以返回上一頁嗎？', false],
  ['不要返回上一頁', false],
  ['返回上一頁再改刷卡', false],
])('recognizes a standalone payment return command: %s', (utterance, expected) => {
  expect(requestsPaymentReturn(String(utterance))).toBe(expected)
})

it('answers method questions without interpreting them as a selection', () => {
  for (const text of ['有沒有其他支付方式？', '有沒有一卡通？', '我想更換付款方式']) {
    expect(paymentChoiceFromSpeech(text)).toBeUndefined()
    expect(paymentOptionsReply(text)).toContain('LINE Pay、信用卡、Apple Pay、綠界 Pay')
  }
  expect(paymentOptionsReply('有沒有一卡通？')).toContain('沒有提供一卡通')
  expect(paymentOptionsReply('我要換一種付款方式')).toContain('您想換成哪一種')
  expect(paymentOptionsReply('有無其他支付方式', undefined, true)).toContain('信用卡、Apple Pay、綠界 Pay')
  expect(paymentOptionsReply('還有其他的嗎？')).toBeUndefined()
  expect(paymentOptionsReply('還有其他的嗎？', ['LINE Pay'], true)).toBe('可以使用LINE Pay。')
  expect(paymentOptionsReply('有沒有其他付款方式？', [], true)).toContain('沒有可用')
  expect(paymentOptionsReply('還有其他餐點嗎？', undefined, true)).toBeUndefined()
  expect(paymentOptionsReply('信用卡卡號怎麼填？')).toBeUndefined()
})
