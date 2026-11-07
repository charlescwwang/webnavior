# ASR 語音辨識服務介接說明

以下為自建的國台語 ASR 語音辨識服務，供需求方進行介接，並共同測試餐飲領域的台語辨識效果。

請需求方自行處理將麥克風收音、語音斷句、音訊格式轉換與上傳，取得辨識文字後接回原有系統。此 API 採用單段錄音上傳、完成後回傳辨識結果的方式，非即時逐字串流。

## API 介接資訊

| 項目 | 設定 |
| --- | --- |
| 請求方式 | `POST` |
| 完整端點 | `https://mcjijz33kp.aikcitri.qzz.io/audio/transcriptions` |
| 請求格式 | `multipart/form-data` |
| 模型名稱 | `kitchen-asr-v0.4` |

此服務的端點不含 `/v1`。此 API 暫時不需要 API Key，呼叫時不需附上 Authorization 標頭。

## 基本參數

| 參數 | 必填 | 建議傳入值與說明 |
| --- | --- | --- |
| `file` | 是 | 錄音檔；建議使用 WAV、16 kHz、單聲道、16-bit PCM，與我們目前使用方式一致 |
| `model` | 否，但請明確指定 | `kitchen-asr-v0.4`；請使用規格中的預設模型名稱 |
| `language` | 否 | `auto`，自動辨識語言 |
| `response_format` | 否，但請明確指定 | `json`，要求回傳 JSON 格式 |

## 呼叫範例

```bash
curl --fail-with-body \
  'https://mcjijz33kp.aikcitri.qzz.io/audio/transcriptions' \
  -F 'file=@recording.wav;type=audio/wav' \
  -F 'model=kitchen-asr-v0.4' \
  -F 'language=auto' \
  -F 'response_format=json'
```

請將 `recording.wav` 改成要上傳的錄音檔路徑。使用上面的 curl 範例即可，不需要另外設定 Content-Type。

現有 AIRI 介接讀取 JSON 回應中的 `text` 欄位。預期使用方式如下，文字僅為示意：

```json
{
  "text": "我要一份招牌便當"
}
```

請先上傳一段錄音，確認能從回應的 `text` 欄位取得辨識文字。如果請求失敗，請記錄錯誤訊息，方便雙方排查。

## Python 範例

先安裝 `requests`：

```bash
python -m pip install requests
```

將以下程式存成 `transcribe.py`，並將 `recording.wav` 改成要上傳的 WAV 錄音檔路徑：

```python
import requests

url = "https://mcjijz33kp.aikcitri.qzz.io/audio/transcriptions"
audio_path = "recording.wav"

with open(audio_path, "rb") as audio:
    response = requests.post(
        url,
        files={"file": ("recording.wav", audio, "audio/wav")},
        data={
            "model": "kitchen-asr-v0.4",
            "language": "auto",
            "response_format": "json",
        },
        timeout=120,
    )

if not response.ok:
    print(f"辨識請求失敗（HTTP {response.status_code}）：{response.text}")
response.raise_for_status()

result = response.json()
print(result["text"])
```

執行後會印出辨識文字：

```bash
python transcribe.py
```

此範例使用已錄好的 WAV 檔，不包含麥克風錄音或音訊格式轉換。`timeout=120` 是範例程式的等待設定，可依需求調整，不代表服務端的時間限制。Python 範例尚未以實際錄音完成連線測試。

## 進階可調參數

初次介接建議先維持預設，不需額外傳入。待現場錄音測試後，再共同討論是否調整。

| 參數 | 預設值 | 用途 |
| --- | --- | --- |
| `prompt` | 空字串 | 提供辨識提示，例如場域詞彙；實際效果需測試 |
| `temperature` | `0` | 辨識生成設定，初期建議維持預設 |
| `denoise` | `false` | 是否啟用降噪 |
| `normalize` | `false` | 是否啟用音訊正規化 |
| `chunking_strategy` | `auto` | 音訊分段策略，初期建議維持預設 |

以上為請求參數，不代表模型重新訓練或台語效果保證。請先使用基本參數完成介接，再以現場國語、台語及混合語音錄音共同驗證。

## 介接配合事項

- 請在應用程式處理上傳失敗、辨識失敗及逾時情況，並保留 HTTP 狀態與必要的錯誤資訊供雙方排查。

## 規格與確認範圍

- [目前模型清單](https://mcjijz33kp.aikcitri.qzz.io/models)

2026-10-22 已確認上述規格與模型清單可讀取，模型清單包含 `kitchen-asr-v0.4`。
本文件整理時，尚未實際上傳音檔驗證辨識回應、台語效果或進階參數的實際行為。
