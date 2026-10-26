/**
 * history 模式入口(http://localhost:5173/)
 * 注意:HTML5 模式下刷新 /users/42 这类深链接,需要服务器回退到 index.html
 * (vite dev 默认支持;静态部署需自行配置,见 README)
 */
import { createApp } from 'vue'
import { buildRouter } from './router'
import { createAppComponent } from './app'

const router = buildRouter('history')
const app = createApp(createAppComponent(router, 'history'))

app.use(router)
app.mount('#app')