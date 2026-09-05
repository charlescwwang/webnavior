declare module 'qrcode' {
  interface ToDataUrlOptions {
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
    margin?: number
    width?: number
  }

  const QRCode: {
    toDataURL: (text: string, options?: ToDataUrlOptions) => Promise<string>
  }

  export default QRCode
}
