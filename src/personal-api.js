import VueCookies from 'vue-cookies';
export async function personalRequest(path, {method = 'GET', data, signal, token = VueCookies.get('authorization') || '', timeout = 10000} = {}) {
  if (!token) throw new Error('请先登录');
  const controller = new AbortController();
  const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, {once:true});
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, timeout);
  try {
    const response = await fetch('/danmu/personal/' + path, {method, signal:controller.signal,
      headers:{Authorization:token, ...(data !== undefined ? {'Content-Type':'application/json'} : {})},
      ...(data !== undefined ? {body:JSON.stringify(data)} : {})});
    const value = await response.json();
    if (!response.ok || value?.code !== 0) throw Object.assign(new Error(value?.msg || '个人数据请求失败'), {status:response.status,code:value?.code});
    return value.data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
