import {sha256} from 'js-sha256';

export function errorText(error) {
  const data = error?.response?.data ?? error?.data ?? error;
  if (data?.code === -15) return '账号或密码错误';
  const message = data?.msg ?? data?.message ?? error?.message ?? data;
  if (typeof message === 'string' && message) return message;
  if (message && typeof message === 'object') {
    for (const key of ['message', 'msg', 'error', 'detail']) {
      if (typeof message[key] === 'string') return message[key];
    }
    return JSON.stringify(message);
  }
  return '请求失败，请稍后重试';
}

export async function loginWithPassword(requests, user) {
  if (!user.username?.trim() || !user.password) throw new Error('请输入账号和密码');
  const server = await requests('GET', '/api/v1/sys/version');
  const parts = String(server?.version ?? '').split('.').map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) throw new Error('无法识别飞牛版本，请使用扫码登录');
  const modern = parts[0] > 0 || parts[1] > 9 || (parts[1] === 9 && parts[2] >= 5);
  const payload = {...user, password: modern ? sha256(user.password) : user.password};
  const result = await requests('POST', modern ? '/api/v2/user/loginByPassword' : '/api/v1/login', false, payload);
  if (typeof result?.token !== 'string' || !result.token) throw new Error('登录接口未返回有效凭证');
  return result;
}

export function danmakuEpisodeNumber(item) {
  const number = Number(item?.episode_number);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

export function episodeDanmaku(json, episode) {
  if (json?.code !== undefined && json.code !== 0) throw new Error(errorText(json));
  const rows = Array.isArray(json) ? json : json?.[String(episode)] ?? [];
  if (!Array.isArray(rows)) throw new Error('弹幕接口返回格式异常');
  return rows;
}

export function nextTheme(isDark, darkTheme) {
  return {dark: !isDark, theme: isDark ? null : darkTheme};
}
