import { fixturePlugin } from './fixtureServer.js'

export default { plugins: [fixturePlugin()], server: { host: '127.0.0.1', port: 5188, strictPort: true } }
