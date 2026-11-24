import { expect, it } from 'vitest'

import { paymentChoiceFromSpeech, paymentOptionsReply } from './paymentChoice'

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

it('answers method questions without interpreting them as a selection', () => {
  for (const text of ['有沒有其他支付方式？', '有沒有一卡通？', '我想更換付款方式']) {
    expect(paymentChoiceFromSpeech(text)).toBeUndefined()
    expect(paymentOptionsReply(text)).toContain('LINE Pay、信用卡、Apple Pay、綠界 Pay')
  }
  expect(paymentOptionsReply('有沒有一卡通？')).toContain('沒有提供一卡通')
  expect(paymentOptionsReply('我要換一種付款方式')).toContain('您想換成哪一種')
  expect(paymentOptionsReply('還有其他的嗎？')).toBeUndefined()
  expect(paymentOptionsReply('還有其他的嗎？', ['LINE Pay'], true)).toBe('可以使用LINE Pay。')
  expect(paymentOptionsReply('有沒有其他付款方式？', [], true)).toContain('沒有可用')
  expect(paymentOptionsReply('還有其他餐點嗎？', undefined, true)).toBeUndefined()
  expect(paymentOptionsReply('信用卡卡號怎麼填？')).toBeUndefined()
})
