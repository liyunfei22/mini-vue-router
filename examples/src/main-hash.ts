/**
 * hash 模式入口(http://localhost:5173/hash.html)
 * hash 模式不需要服务器回退,任何静态服务器都能部署
 */
import { createApp } from 'vue'
import { buildRouter } from './router'
import { createAppComponent } from './app'

const router = buildRouter('hash')
const app = createApp(createAppComponent(router, 'hash'))

app.use(router)
app.mount('#app')