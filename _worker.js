// 相关环境变量(都是可选的)
// KV / DATA_KV / CONFIG_KV: 绑定 Cloudflare KV 命名空间实现后台持久化配置
// SUB_PATH | subpath  订阅路径
// PROXYIP  | proxyip  代理IP
// UUID     | uuid     UUID
// DISABLE_TROJAN | 是否关闭Trojan, 设置为true时关闭，false开启，默认开启 
// DISABLE_SS     | 是否关闭Shadowsocks, 设置为true时关闭，false开启，默认开启
// SSPATH   | sspath   Shadowsocks验证路径, 默认 fengyue
// TOKEN    | SUB_TOKEN 订阅令牌, 同时作为首页登录凭据 (PASSWORD 已移除)

import { connect } from 'cloudflare:sockets';

const DEFAULT_CONFIG = {
    subPath: 'sub',
    password: '123456',
    adminPassword: 'admin',
    proxyIP: 'ProxyIP.CMLiussss.net',
    proxyIPs: ['ProxyIP.CMLiussss.net'],
    landingProxy: '',
    landingProxies: [],
    yourUUID: '5dc15e15-f285-4a9d-959b-0e4fbdd77b63',
    disablevless: false,
    disabletro: false,
    disabless: false,
    ssMethod: 'aes-256-gcm',
    ssPsk: '',
    SSpath: 'fengyue',
    cfip: [],



    clashSubUrl: '',
    singboxSubUrl: ''
};

let subPath = DEFAULT_CONFIG.subPath;
let password = DEFAULT_CONFIG.password;
let adminPassword = DEFAULT_CONFIG.adminPassword;
let proxyIP = DEFAULT_CONFIG.proxyIP;
let proxyIPs = [...DEFAULT_CONFIG.proxyIPs];
let landingProxy = DEFAULT_CONFIG.landingProxy;
let landingProxies = [...DEFAULT_CONFIG.landingProxies];
let yourUUID = DEFAULT_CONFIG.yourUUID;
let yourUUIDBytes = null;
let cachedUUIDStr = '';
let cachedUUIDBytes = null;
let cachedTrojanHash = '';
let disablevless = DEFAULT_CONFIG.disablevless;
let disabletro = DEFAULT_CONFIG.disabletro;
let disabless = DEFAULT_CONFIG.disabless;
let ssMethod = DEFAULT_CONFIG.ssMethod;
let ssPsk = DEFAULT_CONFIG.ssPsk;
let SSpath = DEFAULT_CONFIG.SSpath;
let cfip = [...DEFAULT_CONFIG.cfip];

function getKV(env) {
    if (!env) return null;
    return env.KV || env.DATA_KV || env.CONFIG_KV || null;
}

let memoryConfigCache = null;
let memoryConfigCacheTime = 0;
const CACHE_TTL_MS = 30000; // 内存缓存 30 秒，极速 0ms 响应，大幅降低并发握手延迟

async function loadConfig(env) {
    const now = Date.now();
    if (memoryConfigCache && (now - memoryConfigCacheTime < CACHE_TTL_MS)) {
        return memoryConfigCache;
    }

    let config = { 
        ...DEFAULT_CONFIG, 
        cfip: [...DEFAULT_CONFIG.cfip], 
        proxyIPs: [...DEFAULT_CONFIG.proxyIPs],
        landingProxies: [...DEFAULT_CONFIG.landingProxies]
    };

    // 1. 环境变量覆盖
    if (env) {
        if (env.UUID || env.uuid || env.AUTH) config.yourUUID = env.UUID || env.uuid || env.AUTH;
        if (env.ADMIN || env.admin) config.adminPassword = env.ADMIN || env.admin;
        if (env.SUB_PATH || env.subpath) config.subPath = env.SUB_PATH || env.subpath;
        if (env.SUB_TOKEN || env.sub_token || env.TOKEN || env.token) config.subToken = String(env.SUB_TOKEN || env.sub_token || env.TOKEN || env.token).trim();
        if (env.PROXYIP || env.proxyip || env.proxyIP) {
            const rawProxy = env.PROXYIP || env.proxyip || env.proxyIP;
            const servers = String(rawProxy).split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
            if (servers.length > 0) {
                config.proxyIPs = servers;
                config.proxyIP = servers[0];
            }
        }
        if (env.LANDING_PROXY || env.landing_proxy || env.LD || env.ld) {
            const rawLd = env.LANDING_PROXY || env.landing_proxy || env.LD || env.ld;
            const lds = String(rawLd).split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
            if (lds.length > 0) {
                config.landingProxies = lds;
                config.landingProxy = lds[0];
            }
        }
        if (env.DISABLE_VLESS !== undefined || env.CLOSE_VLESS !== undefined) {
            const dv = env.DISABLE_VLESS || env.CLOSE_VLESS;
            config.disablevless = dv === 'true' || dv === true;
        }
        if (env.DISABLE_TROJAN !== undefined || env.CLOSE_TROJAN !== undefined) {
            const dt = env.DISABLE_TROJAN || env.CLOSE_TROJAN;
            config.disabletro = dt === 'true' || dt === true;
        }
        if (env.DISABLE_SS !== undefined || env.CLOSE_SS !== undefined) {
            const ds = env.DISABLE_SS || env.CLOSE_SS;
            config.disabless = ds === 'true' || ds === true;
        }
        if (env.SS_METHOD || env.ss_method || env.METHOD || env.method) {
            config.ssMethod = env.SS_METHOD || env.ss_method || env.METHOD || env.method;
        }
        if (env.SS_PSK || env.ss_psk || env.PSK || env.psk) {
            config.ssPsk = env.SS_PSK || env.ss_psk || env.PSK || env.psk;
        }
        if (env.SSPATH || env.sspath) config.SSpath = env.SSPATH || env.sspath;
        if (env.CLASH_SUB_URL) config.clashSubUrl = env.CLASH_SUB_URL;
        if (env.SINGBOX_SUB_URL) config.singboxSubUrl = env.SINGBOX_SUB_URL;
    }

    // 2. 从 Cloudflare KV 读取持久化配置
    const kv = getKV(env);
    if (kv) {
        try {
            const kvData = await kv.get('CONFIG', 'json');
            if (kvData && typeof kvData === 'object') {
                if (kvData.yourUUID) config.yourUUID = String(kvData.yourUUID).trim();
                if (kvData.subToken) config.subToken = String(kvData.subToken).trim();
                if (kvData.adminPassword) config.adminPassword = String(kvData.adminPassword).trim();
                else if (kvData.ADMIN) config.adminPassword = String(kvData.ADMIN).trim();
                if (kvData.subPath !== undefined && kvData.subPath !== null) config.subPath = String(kvData.subPath).trim();
                if (Array.isArray(kvData.proxyIPs)) {
                    config.proxyIPs = kvData.proxyIPs.map(s => String(s).trim()).filter(Boolean);
                    config.proxyIP = config.proxyIPs[0] || '';
                } else if (kvData.proxyIP !== undefined && kvData.proxyIP !== null) {
                    const servers = String(kvData.proxyIP).split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
                    config.proxyIPs = servers;
                    config.proxyIP = servers[0] || '';
                }
                if (Array.isArray(kvData.landingProxies)) {
                    config.landingProxies = kvData.landingProxies.map(s => String(s).trim()).filter(Boolean);
                    config.landingProxy = config.landingProxies[0] || '';
                } else if (kvData.landingProxy) {
                    const lds = String(kvData.landingProxy).split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
                    config.landingProxies = lds.length > 0 ? lds : [String(kvData.landingProxy).trim()];
                    config.landingProxy = config.landingProxies[0] || String(kvData.landingProxy).trim();
                }
                if (Array.isArray(kvData.cfip)) config.cfip = kvData.cfip.map(s => String(s).trim()).filter(Boolean);
                if (kvData.disablevless !== undefined) config.disablevless = kvData.disablevless === true || kvData.disablevless === 'true';
                if (kvData.disabletro !== undefined) config.disabletro = kvData.disabletro === true || kvData.disabletro === 'true';
                if (kvData.disabless !== undefined) config.disabless = kvData.disabless === true || kvData.disabless === 'true';
                if (kvData.ssMethod) config.ssMethod = String(kvData.ssMethod).trim();
                if (kvData.ssPsk !== undefined && kvData.ssPsk !== null) config.ssPsk = String(kvData.ssPsk).trim();
                if (kvData.SSpath !== undefined && kvData.SSpath !== null) config.SSpath = String(kvData.SSpath).trim();
                if (kvData.clashSubUrl !== undefined && kvData.clashSubUrl !== null) {
                    const cUrl = String(kvData.clashSubUrl).trim();
                    config.clashSubUrl = (cUrl === 'https://subapi.194216.xyz/sub?target=clash&url=') ? '' : cUrl;
                }
                if (kvData.singboxSubUrl !== undefined && kvData.singboxSubUrl !== null) {
                    const sUrl = String(kvData.singboxSubUrl).trim();
                    config.singboxSubUrl = (sUrl === 'https://subapi.194216.xyz/sub?target=singbox&url=') ? '' : sUrl;
                }
            }
        } catch (e) {
            // KV 读取失败时使用降级配置
        }
    }

    if (!config.subPath) config.subPath = 'sub';
    if (!config.SSpath) config.SSpath = 'fengyue';


    memoryConfigCache = config;
    memoryConfigCacheTime = now;
    return config;
}

async function saveConfig(env, newConfig) {
    const kv = getKV(env);
    if (!kv) {
        throw new Error('未检测到绑定的 KV 命名空间，请先在 Cloudflare 控制台添加名为 KV 的变量绑定');
    }
    await kv.put('CONFIG', JSON.stringify(newConfig));
    memoryConfigCache = null;
    memoryConfigCacheTime = 0;
}

async function resetConfig(env) {
    const kv = getKV(env);
    if (!kv) {
        throw new Error('未检测到绑定的 KV 命名空间');
    }
    await kv.delete('CONFIG');
    memoryConfigCache = null;
    memoryConfigCacheTime = 0;
}

// ------------------------- 鉴权工具：签名令牌 / 恒定时间比较 / 登录限流 -------------------------
const AUTH_TTL_SEC = 86400;
function safeEqual(a, b) {
    a = String(a ?? ''); b = String(b ?? '');
    const len = Math.max(a.length, b.length);
    let diff = a.length ^ b.length;
    for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
}
async function hmacHex(secret, msg) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
    return Array.from(sig, b => b.toString(16).padStart(2, '0')).join('');
}
// 令牌格式：exp.sig，sig = HMAC(密码, role|exp)；改密码后旧令牌自动失效
async function makeAuthToken(role, secret) {
    const exp = Math.floor(Date.now() / 1000) + AUTH_TTL_SEC;
    return `${exp}.${await hmacHex(secret, `${role}|${exp}`)}`;
}
async function verifyAuthToken(token, role, secret) {
    if (!token || !secret) return false;
    const dot = token.indexOf('.');
    if (dot <= 0) return false;
    const exp = parseInt(token.slice(0, dot), 10);
    if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
    return safeEqual(token.slice(dot + 1), await hmacHex(secret, `${role}|${exp}`));
}
function authCookie(name, value, secureFlag, maxAge = AUTH_TTL_SEC) {
    return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secureFlag}`;
}
// 登录限流（按 IP，单实例内存）：5 次失败锁定 15 分钟
const loginFails = new Map();
const LOGIN_MAX_FAILS = 5, LOGIN_LOCK_MS = 15 * 60 * 1000;
function clientIp(request) {
    return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}
function isLoginLocked(request) {
    const ip = clientIp(request);
    const r = loginFails.get(ip);
    if (!r || !r.until) return false;
    if (r.until > Date.now()) return true;
    loginFails.delete(ip);
    return false;
}
function recordLoginFail(request) {
    const ip = clientIp(request);
    const r = loginFails.get(ip) || { n: 0, until: 0 };
    r.n++;
    if (r.n >= LOGIN_MAX_FAILS) { r.until = Date.now() + LOGIN_LOCK_MS; r.n = 0; }
    loginFails.set(ip, r);
    if (loginFails.size > 2000) loginFails.delete(loginFails.keys().next().value);
}
function clearLoginFail(request) { loginFails.delete(clientIp(request)); }
// 校验后台权限：x-password 头（脚本调用）或签名 Cookie
async function isAdminAuthed(request, config) {
    const hdr = request.headers.get('x-password');
    if (hdr !== null) return safeEqual(hdr, config.adminPassword);
    return verifyAuthToken(getCookieValue(request.headers.get('Cookie'), 'cf_admin_pwd'), 'admin', config.adminPassword);
}
function subPathWithToken(config) {
    const path = String(config.subPath || '').replace(/^\/+/, '');
    return config.subToken ? `${path}?token=${encodeURIComponent(config.subToken)}` : path;
}
function maskSecret(v) { v = String(v || ''); return v ? (v.length <= 4 ? '****' : v.slice(0, 2) + '****' + v.slice(-2)) : ''; }
function maskProxyCred(addr) { return String(addr).replace(/(\/\/)([^@\/]+)@/, (m, a) => `${a}****@`); }
function sanitizeConfig(config) {
    return {
        ...config,
        adminPassword: maskSecret(config.adminPassword),
        yourUUID: maskSecret(config.yourUUID),
        ssPsk: maskSecret(config.ssPsk),
        subToken: maskSecret(config.subToken),
        landingProxy: maskProxyCred(config.landingProxy || ''),
        landingProxies: (config.landingProxies || []).map(maskProxyCred),
        proxyIPs: (config.proxyIPs || []).map(maskProxyCred)
    };
}

// ------------------------- Mini TLS 客户端 (来自 CF-Workers-HTTPS / TLSClientMini.js, GPL-3.0) -------------------------
const MiniTlsClient = (() => {
const e=769,t=771,n=772,r=20,i=21,s=22,a=23,h=1,c=2,o=4,l=8,f=11,u=12,y=13,p=14,w=15,d=16,g=20,k=24,v=0,A=10,S=11,m=13,b=16,C=43,H=45,T=51,E=0,L=new TextEncoder,K=new TextDecoder,P=new Uint8Array(0),U=new Map(Object.entries({TLS_AES_128_GCM_SHA256:{id:4865,keyLen:16,ivLen:12,hash:"SHA-256",tls13:!0},TLS_AES_256_GCM_SHA384:{id:4866,keyLen:32,ivLen:12,hash:"SHA-384",tls13:!0},TLS_CHACHA20_POLY1305_SHA256:{id:4867,keyLen:32,ivLen:12,hash:"SHA-256",tls13:!0,chacha:!0},TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256:{id:49199,keyLen:16,ivLen:4,hash:"SHA-256",kex:"ECDHE"},TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384:{id:49200,keyLen:32,ivLen:4,hash:"SHA-384",kex:"ECDHE"},TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256:{id:52392,keyLen:32,ivLen:12,hash:"SHA-256",kex:"ECDHE",chacha:!0},TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256:{id:49195,keyLen:16,ivLen:4,hash:"SHA-256",kex:"ECDHE"},TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384:{id:49196,keyLen:32,ivLen:4,hash:"SHA-384",kex:"ECDHE"},TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256:{id:52393,keyLen:32,ivLen:12,hash:"SHA-256",kex:"ECDHE",chacha:!0}}).map((([,e])=>[e.id,e]))),I=new Map([[29,"X25519"],[23,"P-256"]]),x=[2052,2053,2054,1025,1281,1537,1027,1283,1539],_=(...e)=>{const t=e=>{const n=[];for(const r of e)r instanceof Uint8Array?n.push(...r):Array.isArray(r)?n.push(...t(r)):"number"==typeof r&&n.push(r);return n};return new Uint8Array(t(e))},B=e=>[e>>8&255,255&e],R=(e,t)=>e[t]<<8|e[t+1],M=(e,t)=>e[t]<<16|e[t+1]<<8|e[t+2],W=(...e)=>{const t=e.filter((e=>e&&e.length>0)),n=t.reduce(((e,t)=>e+t.length),0),r=new Uint8Array(n);let i=0;for(const e of t)r.set(e,i),i+=e.length;return r},D=e=>crypto.getRandomValues(new Uint8Array(e)),N=(e,t)=>{if(!e||!t||e.length!==t.length)return!1;let n=0;for(let r=0;r<e.length;r++)n|=e[r]^t[r];return 0===n},q=e=>"SHA-512"===e?64:"SHA-384"===e?48:32;async function $(e,t,n){const r=await crypto.subtle.importKey("raw",t,{name:"HMAC",hash:e},!1,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",r,n))}async function G(e,t){return new Uint8Array(await crypto.subtle.digest(e,t))}async function V(e,t,n,r,i="SHA-256"){const s=W(L.encode(t),n);let a=new Uint8Array(0),h=s;for(;a.length<r;){h=await $(i,e,h);const t=await $(i,e,W(h,s));a=W(a,t)}return a.slice(0,r)}async function X(e,t,n){return t&&t.length||(t=new Uint8Array(q(e))),$(e,t,n)}async function O(e,t,n,r,i){const s=L.encode("tls13 "+n);return async function(e,t,n,r){const i=q(e),s=Math.ceil(r/i);let a=new Uint8Array(0),h=new Uint8Array(0);for(let r=1;r<=s;r++)h=await $(e,t,W(h,n,[r])),a=W(a,h);return a.slice(0,r)}(e,t,_(B(i),s.length,s,r.length,r),i)}async function F(e="P-256"){if("X25519"===e){const e=await crypto.subtle.generateKey({name:"X25519"},!0,["deriveBits"]);return{keyPair:e,publicKeyRaw:new Uint8Array(await crypto.subtle.exportKey("raw",e.publicKey))}}const t=await crypto.subtle.generateKey({name:"ECDH",namedCurve:e},!0,["deriveBits"]);return{keyPair:t,publicKeyRaw:new Uint8Array(await crypto.subtle.exportKey("raw",t.publicKey))}}async function Y(e,t,n="P-256"){if("X25519"===n){const n=await crypto.subtle.importKey("raw",t,{name:"X25519"},!1,[]);return new Uint8Array(await crypto.subtle.deriveBits({name:"X25519",public:n},e,256))}const r=await crypto.subtle.importKey("raw",t,{name:"ECDH",namedCurve:n},!1,[]),i="P-384"===n?384:"P-521"===n?528:256;return new Uint8Array(await crypto.subtle.deriveBits({name:"ECDH",public:r},e,i))}async function j(e,t,n,r){const i=await crypto.subtle.importKey("raw",e,{name:"AES-GCM"},!1,["encrypt"]);return new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:t,additionalData:r,tagLength:128},i,n))}async function z(e,t,n,r){const i=await crypto.subtle.importKey("raw",e,{name:"AES-GCM"},!1,["decrypt"]);return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv:t,additionalData:r,tagLength:128},i,n))}function J(e,t){return(e<<t|e>>>32-t)>>>0}function Q(e,t,n,r,i){e[t]=e[t]+e[n]>>>0,e[i]=J(e[i]^e[t],16),e[r]=e[r]+e[i]>>>0,e[n]=J(e[n]^e[r],12),e[t]=e[t]+e[n]>>>0,e[i]=J(e[i]^e[t],8),e[r]=e[r]+e[i]>>>0,e[n]=J(e[n]^e[r],7)}function Z(e,t,n){const r=new Uint32Array(16);r[0]=1634760805,r[1]=857760878,r[2]=2036477234,r[3]=1797285236;const i=new DataView(e.buffer,e.byteOffset,e.byteLength);for(let e=0;e<8;e++)r[4+e]=i.getUint32(4*e,!0);r[12]=t;const s=new DataView(n.buffer,n.byteOffset,n.byteLength);r[13]=s.getUint32(0,!0),r[14]=s.getUint32(4,!0),r[15]=s.getUint32(8,!0);const a=new Uint32Array(r);for(let e=0;e<10;e++)Q(a,0,4,8,12),Q(a,1,5,9,13),Q(a,2,6,10,14),Q(a,3,7,11,15),Q(a,0,5,10,15),Q(a,1,6,11,12),Q(a,2,7,8,13),Q(a,3,4,9,14);for(let e=0;e<16;e++)a[e]=a[e]+r[e]>>>0;return new Uint8Array(a.buffer.slice(0))}function ee(e,t,n){const r=new Uint8Array(n.length);let i=1;for(let s=0;s<n.length;s+=64){const a=Z(e,i++,t),h=Math.min(64,n.length-s);for(let e=0;e<h;e++)r[s+e]=n[s+e]^a[e]}return r}function te(e,t){const n=function(e){const t=new Uint8Array(e);return t[3]&=15,t[7]&=15,t[11]&=15,t[15]&=15,t[4]&=252,t[8]&=252,t[12]&=252,t}(e.slice(0,16)),r=e.slice(16,32);let i=[0n,0n,0n,0n,0n];const s=[0x3ffffffn&BigInt(n[0]|n[1]<<8|n[2]<<16|n[3]<<24),0x3ffffffn&BigInt(n[3]>>2|n[4]<<6|n[5]<<14|n[6]<<22),0x3ffffffn&BigInt(n[6]>>4|n[7]<<4|n[8]<<12|n[9]<<20),0x3ffffffn&BigInt(n[9]>>6|n[10]<<2|n[11]<<10|n[12]<<18),0x3ffffffn&BigInt(n[13]|n[14]<<8|n[15]<<16)];for(let e=0;e<t.length;e+=16){const n=t.slice(e,e+16),r=new Uint8Array(17);r.set(n),r[n.length]=1,i[0]+=BigInt(r[0]|r[1]<<8|r[2]<<16|(3&r[3])<<24),i[1]+=BigInt(r[3]>>2|r[4]<<6|r[5]<<14|(15&r[6])<<22),i[2]+=BigInt(r[6]>>4|r[7]<<4|r[8]<<12|(63&r[9])<<20),i[3]+=BigInt(r[9]>>6|r[10]<<2|r[11]<<10|r[12]<<18),i[4]+=BigInt(r[13]|r[14]<<8|r[15]<<16|r[16]<<24);const a=[0n,0n,0n,0n,0n];for(let e=0;e<5;e++)for(let t=0;t<5;t++){const n=e+t;n<5?a[n]+=i[e]*s[t]:a[n-5]+=i[e]*s[t]*5n}let h=0n;for(let e=0;e<5;e++)a[e]+=h,i[e]=0x3ffffffn&a[e],h=a[e]>>26n;i[0]+=5n*h,h=i[0]>>26n,i[0]&=0x3ffffffn,i[1]+=h}let a=i[0]|i[1]<<26n|i[2]<<52n|i[3]<<78n|i[4]<<104n;a=a+r.reduce(((e,t,n)=>e+(BigInt(t)<<BigInt(8*n))),0n)&(1n<<128n)-1n;const h=new Uint8Array(16);for(let e=0;e<16;e++)h[e]=Number(a>>BigInt(8*e)&0xffn);return h}function ne(e,t,n,r){const i=Z(e,0,t).slice(0,32),s=ee(e,t,n),a=(16-r.length%16)%16,h=(16-s.length%16)%16,c=new Uint8Array(r.length+a+s.length+h+16);c.set(r,0),c.set(s,r.length+a);const o=new DataView(c.buffer,r.length+a+s.length+h);o.setBigUint64(0,BigInt(r.length),!0),o.setBigUint64(8,BigInt(s.length),!0);const l=te(i,c);return W(s,l)}function re(e,t,n,r){if(n.length<16)throw new Error("Ciphertext too short");const i=n.slice(-16),s=n.slice(0,-16),a=Z(e,0,t).slice(0,32),h=(16-r.length%16)%16,c=(16-s.length%16)%16,o=new Uint8Array(r.length+h+s.length+c+16);o.set(r,0),o.set(s,r.length+h);const l=new DataView(o.buffer,r.length+h+s.length+c);l.setBigUint64(0,BigInt(r.length),!0),l.setBigUint64(8,BigInt(s.length),!0);const f=te(a,o);let u=0;for(let e=0;e<16;e++)u|=i[e]^f[e];if(0!==u)throw new Error("ChaCha20-Poly1305 authentication failed");return ee(e,t,s)}function ie(e,n,r=t){return _(e,B(r),B(n.length),n)}function se(e,t){return _(e,(e=>[e>>16&255,e>>8&255,255&e])(t.length),t)}class ae{constructor(){this.buffer=new Uint8Array(0)}feed(e){this.buffer=W(this.buffer,e)}next(){if(this.buffer.length<5)return null;const e=this.buffer[0],t=R(this.buffer,1),n=R(this.buffer,3);if(this.buffer.length<5+n)return null;const r=this.buffer.slice(5,5+n);return this.buffer=this.buffer.slice(5+n),{type:e,version:t,length:n,fragment:r}}}class he{constructor(){this.buffer=new Uint8Array(0)}feed(e){this.buffer=W(this.buffer,e)}next(){if(this.buffer.length<4)return null;const e=this.buffer[0],t=M(this.buffer,1);if(this.buffer.length<4+t)return null;const n=this.buffer.slice(4,4+t),r=this.buffer.slice(0,4+t);return this.buffer=this.buffer.slice(4+t),{type:e,length:t,body:n,raw:r}}}function ce(e){let t=0;const r=R(e,t);t+=2;const i=e.slice(t,t+32);t+=32;const s=e[t++],a=e.slice(t,t+s);t+=s;const h=R(e,t);t+=2;const c=e[t++];let o=r,l=null,f=null;if(t<e.length){const n=R(e,t);t+=2;const r=t+n;for(;t+4<=r;){const n=R(e,t);t+=2;const r=R(e,t);t+=2;const i=e.slice(t,t+r);if(t+=r,n===C&&r>=2)o=R(i,0);else if(n===T&&r>=4){const e=R(i,0),t=R(i,2);l={group:e,key:i.slice(4,4+t)}}else n===b&&r>=3&&(f=K.decode(i.slice(3,3+i[2])))}}const u=new Uint8Array([207,33,173,116,229,154,97,17,190,29,140,2,30,101,184,145,194,162,17,22,122,187,140,94,7,158,9,226,200,168,51,156]);return{version:r,serverRandom:i,sessionId:a,cipherSuite:h,compression:c,selectedVersion:o,keyShare:l,alpn:f,isHRR:N(i,u),isTls13:o===n}}function oe(e){let t=0;t++;const n=R(e,t);t+=2;const r=e[t++];return{namedCurve:n,serverPublicKey:e.slice(t,t+r)}}function le(e,t=0){let n=0;if(t){const t=e[n++];n+=t}if(n+3>e.length)return null;const r=M(e,n);if(n+=3,!r||n+3>e.length)return null;const i=M(e,n);return n+=3,i?e.slice(n,n+i):null}function fe(e){const t={alpn:null};let n=2;const r=2+R(e,0);for(;n+4<=r;){const r=R(e,n);n+=2;const i=R(e,n);if(n+=2,r===b&&i>=3){const r=e[n+2];r>0&&n+3+r<=n+i&&(t.alpn=K.decode(e.slice(n+3,n+3+r)))}n+=i}return t}const F0=e=>{if(e=String(e??"").trim(),"["===e[0]&&"]"===e[e.length-1]&&(e=e.slice(1,-1)),!e||e.includes(":"))return"";const t=e.split(".");if(4!==t.length)return e;for(const n of t){if(""===n||n.length>3)return e;let t=0;for(let r=0;r<n.length;r++){const i=n.charCodeAt(r)-48;if(i<0||i>9)return e;t=10*t+i}if(t>255)return e}return""},Z0=e=>e&&1===e[0]&&112===e[1];function ue(e,n,r,{tls13:i=!0,tls12:s=!0,alpn:a=null}={}){n=F0(n);const c=[];i&&c.push(4865,4866,4867),s&&c.push(49199,49200,52392,49195,49196,52393);const o=_(...c.flatMap(B)),l=[_(255,1,0,1,0)];if(n){const e=L.encode(n),t=_(0,B(e.length),e);l.push(_(B(v),B(t.length+2),B(t.length),t))}l.push(_(B(S),0,2,1,0)),l.push(_(B(A),0,6,0,4,0,29,0,23));const f=_(...x.flatMap(B));l.push(_(B(m),B(f.length+2),B(f.length),f));const u=Array.isArray(a)?a.filter(Boolean):a?[a]:[];if(u.length){const e=W(...u.map((e=>{const t=L.encode(e);return _(t.length,t)})));l.push(_(B(b),B(e.length+2),B(e.length),e))}if(i&&r){let e;if(l.push(s?_(B(C),0,5,4,3,4,3,3):_(B(C),0,3,2,3,4)),l.push(_(B(H),0,2,1,1)),r?.x25519&&r?.p256)e=W(_(0,29,B(r.x25519.length),r.x25519),_(0,23,B(r.p256.length),r.p256));else if(r?.x25519)e=_(0,29,B(r.x25519.length),r.x25519);else if(r?.p256)e=_(0,23,B(r.p256.length),r.p256);else{if(!(r instanceof Uint8Array))throw new Error("Invalid keyShares");e=_(0,23,B(r.length),r)}l.push(_(B(T),B(e.length+2),B(e.length),e))}const y=W(...l);return se(h,_(B(t),e,0,B(o.length),o,1,0,B(y.length),y))}const ye=e=>{const t=new Uint8Array(8);return new DataView(t.buffer).setBigUint64(0,e,!1),t},pe=(e,t)=>{const n=e.slice(),r=ye(t);for(let e=0;e<8;e++)n[n.length-8+e]^=r[e];return n},we=(e,t,n,r)=>Promise.all([O(e,t,"key",P,n),O(e,t,"iv",P,r)]);return class{constructor(e,t={}){if(this.socket=e,this.serverName=t.serverName||"",this.supportTls13=!1!==t.tls13,this.supportTls12=!1!==t.tls12,!this.supportTls13&&!this.supportTls12)throw new Error("At least one TLS version must be enabled");this.alpnProtocols=Array.isArray(t.alpn)?t.alpn:t.alpn?[t.alpn]:null,this.timeout=t.timeout??3e4,this.clientRandom=D(32),this.serverRandom=null,this.handshakeChunks=[],this.handshakeComplete=!1,this.negotiatedAlpn=null,this.cipherSuite=null,this.cipherConfig=null,this.isTls13=!1,this.masterSecret=null,this.handshakeSecret=null,this.clientWriteKey=null,this.serverWriteKey=null,this.clientWriteIv=null,this.serverWriteIv=null,this.clientHandshakeKey=null,this.serverHandshakeKey=null,this.clientHandshakeIv=null,this.serverHandshakeIv=null,this.clientAppKey=null,this.serverAppKey=null,this.clientAppIv=null,this.serverAppIv=null,this.clientSeqNum=0n,this.serverSeqNum=0n,this.recordParser=new ae,this.handshakeParser=new he,this.keyPairs=new Map,this.ecdhKeyPair=null,this.sawCert=!1}recordHandshake(e){this.handshakeChunks.push(e)}transcript(){return 1===this.handshakeChunks.length?this.handshakeChunks[0]:W(...this.handshakeChunks)}getCipherConfig(e){return U.get(e)||null}async readChunk(e){if(!this.timeout)return e.read();let t;const n=e.read(),r=await Promise.race([n,new Promise(e=>t=setTimeout(e,this.timeout,0))]).finally(()=>clearTimeout(t));if(r)return r;try{await e.cancel("TLS read timeout")}catch{}try{await n}catch{}throw new Error("TLS read timeout")}async pr(e,t,n){for(;;){let r;for(;r=this.recordParser.next();)if(await t(r))return;const{value:i,done:s}=await this.readChunk(e);if(s)throw new Error(n);this.recordParser.feed(i)}}async ph(e,t,n){for(let e;e=this.handshakeParser.next();)if(await t(e))return;return this.pr(e,(async e=>{if(e.type===i){if(Z0(e.fragment))return;throw new Error(`TLS Alert: ${e.fragment[1]}`)}if(e.type===s){this.handshakeParser.feed(e.fragment);for(let e;e=this.handshakeParser.next();)if(await t(e))return 1}}),n)}async acceptCertificate(e){if(!e?.length)throw new Error("Empty certificate");this.sawCert=!0}async handshake(){const[t,n]=await Promise.all([F("P-256"),F("X25519")]);this.keyPairs=new Map([[23,t],[29,n]]),this.ecdhKeyPair=t.keyPair;const r=this.socket.readable.getReader(),i=this.socket.writable.getWriter();try{const a=ue(this.clientRandom,this.serverName,{x25519:n.publicKeyRaw,p256:t.publicKeyRaw},{tls13:this.supportTls13,tls12:this.supportTls12,alpn:this.alpnProtocols});this.recordHandshake(a),await i.write(ie(s,a,e));const h=await this.receiveServerHello(r);if(h.isHRR)throw new Error("HelloRetryRequest is not supported by TLSClientMini");if(h.keyShare?.group&&this.keyPairs.has(h.keyShare.group)){const e=this.keyPairs.get(h.keyShare.group);this.ecdhKeyPair=e.keyPair}h.isTls13?await this.handshakeTls13(r,i,h):await this.handshakeTls12(r,i),this.handshakeComplete=!0}finally{r.releaseLock(),i.releaseLock()}}async receiveServerHello(e){for(;;){const{value:t,done:n}=await this.readChunk(e);if(n)throw new Error("Connection closed waiting for ServerHello");let r;for(this.recordParser.feed(t);r=this.recordParser.next();){if(r.type===i){if(Z0(r.fragment))continue;throw new Error(`TLS Alert: level=${r.fragment[0]}, desc=${r.fragment[1]}`)}if(r.type!==s)continue;let e;for(this.handshakeParser.feed(r.fragment);e=this.handshakeParser.next();){if(e.type!==c)continue;this.recordHandshake(e.raw);const t=ce(e.body);if(this.serverRandom=t.serverRandom,this.cipherSuite=t.cipherSuite,this.cipherConfig=this.getCipherConfig(t.cipherSuite),this.isTls13=t.isTls13,this.negotiatedAlpn=t.alpn||null,!this.cipherConfig)throw new Error(`Unsupported cipher suite: 0x${t.cipherSuite.toString(16)}`);return t}}}}async handshakeTls12(e,t){let n=null,a=!1;if(await this.ph(e,(async e=>{switch(e.type){case f:{this.recordHandshake(e.raw);const t=le(e.body,1);if(!t)throw new Error("Missing TLS 1.2 certificate");await this.acceptCertificate(t);break}case u:this.recordHandshake(e.raw),n=oe(e.body);break;case p:return this.recordHandshake(e.raw),a=!0,1;case y:throw new Error("Client certificate is not supported");default:this.recordHandshake(e.raw)}}),"Connection closed during TLS 1.2 handshake"),!this.sawCert)throw new Error("Missing TLS 1.2 leaf certificate");if(!n)throw new Error("Missing TLS 1.2 ServerKeyExchange");const h=I.get(n.namedCurve);if(!h)throw new Error(`Unsupported named curve: 0x${n.namedCurve.toString(16)}`);const c=this.keyPairs.get(n.namedCurve);if(!c)throw new Error(`Missing key pair for curve: 0x${n.namedCurve.toString(16)}`);const o=await Y(c.keyPair.privateKey,n.serverPublicKey,h),l=se(d,_(c.publicKeyRaw.length,c.publicKeyRaw));this.recordHandshake(l);const w=this.cipherConfig.hash;this.masterSecret=await V(o,"master secret",W(this.clientRandom,this.serverRandom),48,w);const k=this.cipherConfig.keyLen,v=this.cipherConfig.ivLen,A=await V(this.masterSecret,"key expansion",W(this.serverRandom,this.clientRandom),2*k+2*v,w);this.clientWriteKey=A.slice(0,k),this.serverWriteKey=A.slice(k,2*k),this.clientWriteIv=A.slice(2*k,2*k+v),this.serverWriteIv=A.slice(2*k+v,2*k+2*v),await t.write(ie(s,l)),await t.write(ie(r,_(1)));const S=await V(this.masterSecret,"client finished",await G(w,this.transcript()),12,w),m=se(g,S);this.recordHandshake(m),await t.write(ie(s,await this.encryptTls12(m,s)));let b=!1;await this.pr(e,(async e=>{if(e.type===i){if(Z0(e.fragment))return;throw new Error(`TLS Alert: ${e.fragment[1]}`)}if(e.type===r)return void(b=!0);if(e.type!==s||!b)return;const t=await this.decryptTls12(e.fragment,s);if(t[0]!==g)return;const n=M(t,1),a=t.slice(4,4+n),h=await V(this.masterSecret,"server finished",await G(w,this.transcript()),12,w);if(!N(a,h))throw new Error("TLS 1.2 server Finished verify failed");return 1}),"Connection closed waiting for TLS 1.2 Finished")}async handshakeTls13(e,t,n){const h=I.get(n.keyShare?.group);if(!h||!n.keyShare?.key?.length)throw new Error("Missing TLS 1.3 key_share");const c=this.cipherConfig.hash,o=q(c),u=this.cipherConfig.keyLen,p=this.cipherConfig.ivLen,d=await Y(this.ecdhKeyPair.privateKey,n.keyShare.key,h),k=await X(c,null,new Uint8Array(o)),v=await O(c,k,"derived",await G(c,P),o);this.handshakeSecret=await X(c,v,d);const A=await G(c,this.transcript()),S=await O(c,this.handshakeSecret,"c hs traffic",A,o),m=await O(c,this.handshakeSecret,"s hs traffic",A,o);[this.clientHandshakeKey,this.clientHandshakeIv]=await we(c,S,u,p),[this.serverHandshakeKey,this.serverHandshakeIv]=await we(c,m,u,p);const b=await O(c,m,"finished",P,o);let C=!1;const H=async e=>{switch(e.type){case l:{const t=fe(e.body);t.alpn&&(this.negotiatedAlpn=t.alpn),this.recordHandshake(e.raw);break}case f:{const t=le(e.body);if(!t)throw new Error("Missing TLS 1.3 certificate");await this.acceptCertificate(t),this.recordHandshake(e.raw);break}case y:throw new Error("Client certificate is not supported");case w:this.recordHandshake(e.raw);break;case g:{const t=await $(c,b,await G(c,this.transcript()));if(!N(t,e.body))throw new Error("TLS 1.3 server Finished verify failed");this.recordHandshake(e.raw),C=!0;break}default:this.recordHandshake(e.raw)}};await this.pr(e,(async e=>{if(e.type===r||e.type===s)return;if(e.type===i){if(Z0(e.fragment))return;throw new Error(`TLS Alert: ${e.fragment[1]}`)}if(e.type!==a)return;const t=await this.decryptTls13Handshake(e.fragment),n=t[t.length-1],h=t.slice(0,-1);if(n===s){this.handshakeParser.feed(h);for(let e;e=this.handshakeParser.next();)if(await H(e),C)return 1}}),"Connection closed during TLS 1.3 handshake");const T=await G(c,this.transcript()),E=await O(c,this.handshakeSecret,"derived",await G(c,P),o),L=await X(c,E,new Uint8Array(o)),K=await O(c,L,"c ap traffic",T,o),U=await O(c,L,"s ap traffic",T,o);[this.clientAppKey,this.clientAppIv]=await we(c,K,u,p),[this.serverAppKey,this.serverAppIv]=await we(c,U,u,p);const x=await O(c,S,"finished",P,o),_=await $(c,x,await G(c,this.transcript())),B=se(g,_);this.recordHandshake(B),await t.write(ie(a,await this.encryptTls13Handshake(W(B,[s])))),this.clientSeqNum=0n,this.serverSeqNum=0n}async encryptTls12(e,n){const r=this.clientSeqNum++,i=ye(r),s=W(i,[n],B(t),B(e.length));if(this.cipherConfig.chacha){const t=pe(this.clientWriteIv,r);return ne(this.clientWriteKey,t,e,s)}const a=D(8);return W(a,await j(this.clientWriteKey,W(this.clientWriteIv,a),e,s))}async decryptTls12(e,n){const r=this.serverSeqNum++,i=ye(r);if(this.cipherConfig.chacha){const s=pe(this.serverWriteIv,r);return re(this.serverWriteKey,s,e,W(i,[n],B(t),B(e.length-16)))}const s=e.slice(0,8),a=e.slice(8);return z(this.serverWriteKey,W(this.serverWriteIv,s),a,W(i,[n],B(t),B(a.length-16)))}async encryptTls13Handshake(e){const t=pe(this.clientHandshakeIv,this.clientSeqNum++),n=_(a,3,3,B(e.length+16));return this.cipherConfig.chacha?ne(this.clientHandshakeKey,t,e,n):j(this.clientHandshakeKey,t,e,n)}async decryptTls13Handshake(e){const t=pe(this.serverHandshakeIv,this.serverSeqNum++),n=_(a,3,3,B(e.length)),r=await(this.cipherConfig.chacha?re(this.serverHandshakeKey,t,e,n):z(this.serverHandshakeKey,t,e,n));let i=r.length-1;for(;i>=0&&!r[i];)i--;return i<0?P:r.slice(0,i+1)}async encryptTls13(e){const t=W(e,[a]),n=pe(this.clientAppIv,this.clientSeqNum++),r=_(a,3,3,B(t.length+16));return this.cipherConfig.chacha?ne(this.clientAppKey,n,t,r):j(this.clientAppKey,n,t,r)}async decryptTls13(e){const t=pe(this.serverAppIv,this.serverSeqNum++),n=_(a,3,3,B(e.length)),r=this.cipherConfig.chacha?await re(this.serverAppKey,t,e,n):await z(this.serverAppKey,t,e,n);let i=r.length-1;for(;i>=0&&!r[i];)i--;return i<0?{data:P,type:0}:{data:r.slice(0,i),type:r[i]}}async write(e){if(!this.handshakeComplete)throw new Error("Handshake not complete");const t=this.socket.writable.getWriter();try{this.isTls13?await t.write(ie(a,await this.encryptTls13(e))):await t.write(ie(a,await this.encryptTls12(e,a)))}finally{t.releaseLock()}}async read(){for(;;){let e;for(;e=this.recordParser.next();){if(e.type===i){if(e.fragment[1]===E)return null;throw new Error(`TLS Alert: ${e.fragment[1]}`)}if(e.type!==a)continue;if(!this.isTls13)return this.decryptTls12(e.fragment,a);const{data:t,type:n}=await this.decryptTls13(e.fragment);if(n===a)return t;if(n===i){if(t[1]===E)return null;throw new Error(`TLS Alert: ${t[1]}`)}if(n!==s)continue;let r;for(this.handshakeParser.feed(t);r=this.handshakeParser.next();)if(r.type!==o&&r.type===k)throw new Error("TLS 1.3 KeyUpdate is not supported by TLSClientMini")}const t=this.socket.readable.getReader();try{const{value:e,done:n}=await this.readChunk(t);if(n)return null;this.recordParser.feed(e)}finally{t.releaseLock()}}}close(){this.socket.close()}}
})();

const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
function closeSocketQuietly(socket) { 
    if (!socket) return;
    try { 
        if (typeof socket.close === 'function') {
            if (socket.readyState !== undefined) {
                if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
                    socket.close(); 
                }
            } else {
                socket.close();
            }
        }
    } catch (error) {} 
}

// ------------------------- Shadowsocks 全协议密码学引擎 (18 种算法支持) -------------------------
const C_SS = { 
    none: { k: 16, iv: 0, aead: 0, s: 0, none: 1 }, 
    plain: { k: 16, iv: 0, aead: 0, s: 0, none: 1 }, 
    'aes-128-gcm': { k: 16, iv: 16, aead: 1, tag: 16 }, 
    'aes-192-gcm': { k: 24, iv: 24, aead: 1, tag: 16 }, 
    'aes-256-gcm': { k: 32, iv: 32, aead: 1, tag: 16 }, 
    'chacha20-ietf-poly1305': { k: 32, iv: 32, aead: 1, tag: 16, cc: 1 }, 
    'xchacha20-ietf-poly1305': { k: 32, iv: 32, aead: 1, tag: 16, xc: 1 }, 
    'chacha20-ietf': { k: 32, iv: 12, s: 1, st: 'cc' }, 
    'xchacha20': { k: 32, iv: 24, s: 1, st: 'xc' }, 
    'aes-128-ctr': { k: 16, iv: 16, s: 1, st: 'ctr' }, 
    'aes-192-ctr': { k: 24, iv: 16, s: 1, st: 'ctr' }, 
    'aes-256-ctr': { k: 32, iv: 16, s: 1, st: 'ctr' }, 
    'aes-128-cfb': { k: 16, iv: 16, s: 1, st: 'cfb' }, 
    'aes-192-cfb': { k: 24, iv: 16, s: 1, st: 'cfb' }, 
    'aes-256-cfb': { k: 32, iv: 16, s: 1, st: 'cfb' }, 
    'rc4-md5': { k: 16, iv: 16, s: 1, st: 'rc4' }, 
    '2022-blake3-aes-128-gcm': { k: 16, iv: 16, aead: 1, tag: 16, b3: 1 }, 
    '2022-blake3-aes-256-gcm': { k: 32, iv: 32, aead: 1, tag: 16, b3: 1 }, 
    '2022-blake3-chacha20-poly1305': { k: 32, iv: 32, aead: 1, tag: 16, b3: 1, cc: 1 } 
};

const enc_ss = new TextEncoder();
const dec_ss = new TextDecoder();
const CC_SS = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
const rotl_ss = (a, b) => ((a << b) | (a >>> (32 - b))) >>> 0;
const rotr_ss = (a, b) => ((a >>> b) | (a << (32 - b))) >>> 0;
const qr_ss = (x, a, b, c, d) => { 
    x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl_ss(x[d] ^ x[a], 16); 
    x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl_ss(x[b] ^ x[c], 12); 
    x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl_ss(x[d] ^ x[a], 8); 
    x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl_ss(x[b] ^ x[c], 7); 
};
const cat_ss = (...xs) => { 
    const r = new Uint8Array(xs.reduce((n, x) => n + x.length, 0)); 
    let o = 0; 
    for (const x of xs) { r.set(x, o); o += x.length; } 
    return r; 
};
const pushBuf_ss = (b, d) => b.length ? cat_ss(b, d) : d;
const u16be_ss = (d, o) => (d[o] << 8) | d[o + 1];
const put16_ss = (d, o, v) => { d[o] = (v >> 8) & 255; d[o + 1] = v & 255; };
const Z16_ss = new Uint8Array(16);
const Z20_ss = new Uint8Array(20);

const ccRounds_ss = w => { 
    for (let i = 0; i < 10; i++) { 
        qr_ss(w, 0, 4, 8, 12); qr_ss(w, 1, 5, 9, 13); qr_ss(w, 2, 6, 10, 14); qr_ss(w, 3, 7, 11, 15); 
        qr_ss(w, 0, 5, 10, 15); qr_ss(w, 1, 6, 11, 12); qr_ss(w, 2, 7, 8, 13); qr_ss(w, 3, 4, 9, 14); 
    } 
};
const ccBlk_ss = (key, ctr, nonce) => { 
    const s = new Uint32Array(16);
    const kv = new DataView(key.buffer, key.byteOffset, 32);
    const nv = new DataView(nonce.buffer, nonce.byteOffset, nonce.length); 
    s.set(CC_SS); 
    for (let i = 0; i < 8; i++) s[4 + i] = kv.getUint32(i * 4, true); 
    s[12] = ctr; 
    if (nonce.length === 12) { 
        s[13] = nv.getUint32(0, true); s[14] = nv.getUint32(4, true); s[15] = nv.getUint32(8, true); 
    } else { 
        s[13] = 0; s[14] = nv.getUint32(0, true); s[15] = nv.getUint32(4, true); 
    } 
    const w = new Uint32Array(s); 
    ccRounds_ss(w); 
    for (let i = 0; i < 16; i++) w[i] = (w[i] + s[i]) >>> 0; 
    return new Uint8Array(w.buffer); 
};
const hcc_ss = (key, n16) => { 
    const s = new Uint32Array(16);
    const kv = new DataView(key.buffer, key.byteOffset, 32);
    const nv = new DataView(n16.buffer, n16.byteOffset, 16); 
    s.set(CC_SS); 
    for (let i = 0; i < 8; i++) s[4 + i] = kv.getUint32(i * 4, true); 
    for (let i = 0; i < 4; i++) s[12 + i] = nv.getUint32(i * 4, true); 
    const w = new Uint32Array(s); 
    ccRounds_ss(w); 
    const o = new Uint8Array(32);
    const ov = new DataView(o.buffer); 
    ov.setUint32(0, w[0], true); ov.setUint32(4, w[1], true); ov.setUint32(8, w[2], true); ov.setUint32(12, w[3], true); 
    ov.setUint32(16, w[12], true); ov.setUint32(20, w[13], true); ov.setUint32(24, w[14], true); ov.setUint32(28, w[15], true); 
    return o; 
};
const ccStrm_ss = (key, nonce, data, ctr = 0) => { 
    const o = new Uint8Array(data.length); 
    for (let i = 0, c = ctr; i < data.length; i += 64, c++) { 
        const b = ccBlk_ss(key, c, nonce); 
        for (let j = 0; j < 64 && i + j < data.length; j++) o[i + j] = data[i + j] ^ b[j]; 
    } 
    return o; 
};
const xcStrm_ss = (key, n24, data, ctr = 0) => { 
    const sk = hcc_ss(key, n24.subarray(0, 16));
    const sn = new Uint8Array(12); 
    sn.set(n24.subarray(16, 24), 4); 
    return ccStrm_ss(sk, sn, data, ctr); 
};
const poly_ss = (key, msg) => { 
    const r = new Uint32Array(5), h = new Uint32Array(5);
    const kv = new DataView(key.buffer, key.byteOffset, 32); 
    r[0] = kv.getUint32(0, true) & 0x3ffffff; 
    r[1] = (kv.getUint32(3, true) >>> 2) & 0x3ffff03; 
    r[2] = (kv.getUint32(6, true) >>> 4) & 0x3ffc0ff; 
    r[3] = (kv.getUint32(9, true) >>> 6) & 0x3f03fff; 
    r[4] = (kv.getUint32(12, true) >>> 8) & 0x00fffff; 
    const pad = [kv.getUint32(16, true), kv.getUint32(20, true), kv.getUint32(24, true), kv.getUint32(28, true)]; 
    for (let i = 0; i < msg.length; i += 16) { 
        const ck = msg.subarray(i, Math.min(i + 16, msg.length));
        const buf = new Uint8Array(17); 
        buf.set(ck); 
        buf[ck.length] = 1; 
        const bv = new DataView(buf.buffer);
        const n = [
            bv.getUint32(0, true) & 0x3ffffff, 
            (bv.getUint32(3, true) >>> 2) & 0x3ffffff, 
            (bv.getUint32(6, true) >>> 4) & 0x3ffffff, 
            (bv.getUint32(9, true) >>> 6) & 0x3ffffff, 
            ck.length < 16 ? 0 : ((bv.getUint32(12, true) >>> 8) | (1 << 24))
        ]; 
        for (let j = 0; j < 5; j++) h[j] = (h[j] + n[j]) >>> 0; 
        const d = new BigUint64Array(5); 
        for (let j = 0; j < 5; j++) {
            for (let k = 0; k < 5; k++) {
                d[j] += BigInt(h[k]) * (k <= j ? BigInt(r[j - k]) : BigInt(r[j - k + 5]) * 5n); 
            }
        }
        let c = 0n; 
        for (let j = 0; j < 5; j++) { 
            d[j] += c; 
            h[j] = Number(d[j] & 0x3ffffffn); 
            c = d[j] >> 26n; 
        } 
        h[0] += Number(c) * 5; 
    } 
    let c = h[0] >>> 26; h[0] &= 0x3ffffff; 
    for (let i = 1; i < 5; i++) { h[i] += c; c = h[i] >>> 26; h[i] &= 0x3ffffff; } 
    h[0] += c * 5; c = h[0] >>> 26; h[0] &= 0x3ffffff; h[1] += c; 
    const g = new Uint32Array(5); c = 5; 
    for (let i = 0; i < 5; i++) { g[i] = h[i] + c; c = g[i] >>> 26; g[i] &= 0x3ffffff; } 
    g[4] -= (1 << 26); 
    const m = (g[4] >>> 31) - 1; 
    for (let i = 0; i < 5; i++) h[i] = (h[i] & ~m) | (g[i] & m); 
    const f = new Uint32Array(4); 
    f[0] = (h[0] | (h[1] << 26)) >>> 0; 
    f[1] = ((h[1] >>> 6) | (h[2] << 20)) >>> 0; 
    f[2] = ((h[2] >>> 12) | (h[3] << 14)) >>> 0; 
    f[3] = ((h[3] >>> 18) | (h[4] << 8)) >>> 0; 
    let carry = 0n; 
    for (let i = 0; i < 4; i++) { 
        const sum = BigInt(f[i]) + BigInt(pad[i]) + carry; 
        f[i] = Number(sum & 0xffffffffn); 
        carry = sum >> 32n; 
    } 
    return new Uint8Array(f.buffer); 
};
const polyKey_ss = (key, nonce, xc) => { 
    if (!xc) return ccBlk_ss(key, 0, nonce).subarray(0, 32); 
    const sk = hcc_ss(key, nonce.subarray(0, 16));
    const sn = new Uint8Array(12); 
    sn.set(nonce.subarray(16, 24), 4); 
    return ccBlk_ss(sk, 0, sn).subarray(0, 32); 
};
const polyTag_ss = (pk, ct) => { 
    const pc = new Uint8Array(Math.ceil(ct.length / 16) * 16); 
    pc.set(ct); 
    const md = new Uint8Array(pc.length + 16); 
    md.set(pc); 
    const dv = new DataView(md.buffer); 
    dv.setBigUint64(pc.length, 0n, true); 
    dv.setBigUint64(pc.length + 8, BigInt(ct.length), true); 
    return poly_ss(pk, md); 
};
const eq16_ss = (a, b) => { 
    let x = 0; 
    for (let i = 0; i < 16; i++) x |= a[i] ^ b[i]; 
    return x === 0; 
};
const ccEnc_ss = (key, nonce, pt, xc) => { 
    const ct = (xc ? xcStrm_ss : ccStrm_ss)(key, nonce, pt, 1); 
    return cat_ss(ct, polyTag_ss(polyKey_ss(key, nonce, xc), ct)); 
};
const ccDec_ss = (key, nonce, data, xc) => { 
    if (data.length < 16) return null; 
    const ct = data.subarray(0, data.length - 16);
    const tag = data.subarray(data.length - 16); 
    return eq16_ss(tag, polyTag_ss(polyKey_ss(key, nonce, xc), ct)) ? (xc ? xcStrm_ss : ccStrm_ss)(key, nonce, ct, 1) : null; 
};

const B3IV_ss = new Uint32Array([0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]);
const B3P_ss = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const b3c_ss = (cv, blk, blen, ctr, fl) => { 
    const v = new Uint32Array(16); 
    v.set(cv.slice(0, 8)); 
    v.set(B3IV_ss, 8); 
    v[12] = ctr & 0xFFFFFFFF; 
    v[13] = (ctr / 0x100000000) >>> 0; 
    v[14] = blen; 
    v[15] = fl; 
    let m = new Uint32Array(16); 
    for (let i = 0; i < 16; i++) m[i] = blk[i * 4] | (blk[i * 4 + 1] << 8) | (blk[i * 4 + 2] << 16) | (blk[i * 4 + 3] << 24); 
    const g = (a, b, c, d, mx, my) => { 
        v[a] = (v[a] + v[b] + mx) >>> 0; v[d] = rotr_ss(v[d] ^ v[a], 16); 
        v[c] = (v[c] + v[d]) >>> 0; v[b] = rotr_ss(v[b] ^ v[c], 12); 
        v[a] = (v[a] + v[b] + my) >>> 0; v[d] = rotr_ss(v[d] ^ v[a], 8); 
        v[c] = (v[c] + v[d]) >>> 0; v[b] = rotr_ss(v[b] ^ v[c], 7); 
    }; 
    for (let r = 0; r < 7; r++) { 
        g(0, 4, 8, 12, m[0], m[1]); g(1, 5, 9, 13, m[2], m[3]); g(2, 6, 10, 14, m[4], m[5]); g(3, 7, 11, 15, m[6], m[7]); 
        g(0, 5, 10, 15, m[8], m[9]); g(1, 6, 11, 12, m[10], m[11]); g(2, 7, 8, 13, m[12], m[13]); g(3, 4, 9, 14, m[14], m[15]); 
        const pm = new Uint32Array(16); 
        for (let i = 0; i < 16; i++) pm[i] = m[B3P_ss[i]]; 
        m = pm; 
    } 
    for (let i = 0; i < 8; i++) cv[i] = v[i] ^ v[i + 8]; 
};
const b3k_ss = (ctx, km, len = 32) => { 
    const cb = enc_ss.encode(ctx);
    const cblk = new Uint8Array(64); 
    cblk.set(cb.subarray(0, 64)); 
    const cv1 = new Uint32Array(B3IV_ss); 
    b3c_ss(cv1, cblk, Math.min(cb.length, 64), 0, 0x2B); 
    const kblk = new Uint8Array(64); 
    kblk.set(km.subarray(0, 64)); 
    const cv2 = new Uint32Array(cv1); 
    b3c_ss(cv2, kblk, Math.min(km.length, 64), 0, 0x4B); 
    return new Uint8Array(cv2.buffer).slice(0, len); 
};
const md5Digest_ss = async (data) => {
    try {
        return new Uint8Array(await crypto.subtle.digest('MD5', data));
    } catch {
        if (typeof require !== 'undefined') {
            try {
                const nc = require('crypto');
                return new Uint8Array(nc.createHash('md5').update(data).digest());
            } catch {}
        }
        return new Uint8Array(await crypto.subtle.digest('SHA-256', data)).slice(0, 16);
    }
};

const evp_ss = async (pw, kl) => { 
    const p = enc_ss.encode(pw); 
    let k = new Uint8Array(0), pv = new Uint8Array(0); 
    while (k.length < kl) { 
        const d = new Uint8Array(pv.length + p.length); 
        d.set(pv); 
        d.set(p, pv.length); 
        pv = await md5Digest_ss(d); 
        const nk = new Uint8Array(k.length + pv.length); 
        nk.set(k); 
        nk.set(pv, k.length); 
        k = nk; 
    } 
    return k.slice(0, kl); 
};
const hkdf_ss = async (ikm, salt, info, len) => { 
    const k1 = await crypto.subtle.importKey('raw', salt.length ? salt : Z20_ss, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const prk = new Uint8Array(await crypto.subtle.sign('HMAC', k1, ikm));
    const k2 = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const okm = new Uint8Array(Math.ceil(len / 20) * 20); 
    let pv = new Uint8Array(0); 
    for (let i = 0; i < Math.ceil(len / 20); i++) { 
        const inp = cat_ss(pv, info, new Uint8Array([i + 1])); 
        pv = new Uint8Array(await crypto.subtle.sign('HMAC', k2, inp)); 
        okm.set(pv, i * 20); 
    } 
    return okm.slice(0, len); 
};
const sesKey_ss = async (mk, salt, info) => info.b3 ? b3k_ss("shadowsocks 2022 session subkey", cat_ss(mk, salt), info.k) : await hkdf_ss(mk, salt, enc_ss.encode('ss-subkey'), info.k);

class AEAD_SS { 
    constructor(key, info) { 
        this.key = key; 
        this.info = info; 
        this.nonce = new Uint8Array(info.cc ? 12 : info.xc ? 24 : 12); 
        this.ck = null; 
    } 
    async init() { 
        if (!this.info.cc && !this.info.xc) {
            this.ck = await crypto.subtle.importKey('raw', this.key, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); 
        }
    } 
    inc() { 
        for (let i = 0; i < this.nonce.length; i++) { 
            this.nonce[i]++; 
            if (this.nonce[i]) break; 
        } 
    } 
    async enc(d) { 
        let c; 
        if (this.info.cc) c = ccEnc_ss(this.key, this.nonce, d, false); 
        else if (this.info.xc) c = ccEnc_ss(this.key, this.nonce, d, true); 
        else c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: this.nonce, tagLength: 128 }, this.ck, d)); 
        this.inc(); 
        return c; 
    } 
    async dec(d) { 
        try { 
            let p; 
            if (this.info.cc) { 
                p = ccDec_ss(this.key, this.nonce, d, false); 
                if (!p) return null; 
            } else if (this.info.xc) { 
                p = ccDec_ss(this.key, this.nonce, d, true); 
                if (!p) return null; 
            } else {
                p = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.nonce, tagLength: 128 }, this.ck, d)); 
            }
            this.inc(); 
            return p; 
        } catch { 
            return null; 
        } 
    } 
}

class Strm_SS {
    constructor(key, iv, info, isEnc) { 
        this.key = key; 
        this.iv = new Uint8Array(iv); 
        this.info = info; 
        this.isEnc = isEnc; 
        this.ctr = 0; 
        this.pos = 0; 
        this.rc4s = null; 
        this.rc4i = 0; 
        this.rc4j = 0; 
        this.ks = null; 
        this.ksPos = 0; 
        this.ak = null; 
        this.xk = this.xn = this.b32 = null; 
        if (info.st === 'xc') { 
            this.xk = hcc_ss(this.key, this.iv.subarray(0, 16)); 
            this.xn = new Uint8Array(12); 
            this.xn.set(this.iv.subarray(16, 24), 4); 
        } 
    }
    _cfbBlk() { 
        const b = this.b32 ??= new Uint8Array(32); 
        b.fill(0); 
        b.set(this.iv); 
        return b; 
    }
    async crypt(d) { 
        const { st } = this.info;
        if (st === 'cc' || st === 'xc') { 
            const o = new Uint8Array(d.length); 
            let di = 0; 
            while (di < d.length && this.ks && this.ksPos < 64) { 
                o[di] = d[di] ^ this.ks[this.ksPos]; 
                di++; this.ksPos++; 
            } 
            if (di >= d.length) return o; 
            const rem = d.subarray(di);
            const key = st === 'xc' ? this.xk : this.key;
            const iv = st === 'xc' ? this.xn : this.iv;
            const e = ccStrm_ss(key, iv, rem, this.ctr); 
            o.set(e, di); 
            const bu = Math.ceil(rem.length / 64); 
            this.ctr += bu; 
            if (rem.length % 64) { 
                this.ks = ccBlk_ss(key, this.ctr - 1, iv); 
                this.ksPos = rem.length % 64; 
            } else { 
                this.ks = null; this.ksPos = 0; 
            } 
            return o; 
        }
        if (st === 'ctr') { 
            const ak = await (this.ak ??= crypto.subtle.importKey('raw', this.key, { name: 'AES-CTR' }, false, ['encrypt']));
            const o = new Uint8Array(d.length); 
            let di = 0; 
            while (di < d.length && this.ks && this.ksPos < 16) { 
                o[di] = d[di] ^ this.ks[this.ksPos]; 
                di++; this.ksPos++; 
                this.pos++; 
            } 
            if (di >= d.length) return o; 
            const ctrVal = new Uint8Array(this.iv); 
            let carry = Math.floor(this.pos / 16); 
            for (let i = 15; i >= 0 && carry > 0; i--) { 
                const sum = ctrVal[i] + (carry & 0xff); 
                ctrVal[i] = sum & 0xff; 
                carry = (carry >> 8) + (sum >> 8); 
            } 
            const rem = d.subarray(di);
            const e = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CTR', counter: ctrVal, length: 128 }, ak, rem)); 
            o.set(e, di); 
            this.pos += rem.length; 
            if (rem.length % 16) { 
                const lc = new Uint8Array(this.iv); 
                let c2 = Math.floor((this.pos - 1) / 16); 
                for (let i = 15; i >= 0 && c2 > 0; i--) { 
                    const sum = lc[i] + (c2 & 0xff); 
                    lc[i] = sum & 0xff; 
                    c2 = (c2 >> 8) + (sum >> 8); 
                } 
                this.ks = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CTR', counter: lc, length: 128 }, ak, Z16_ss)); 
                this.ksPos = rem.length % 16; 
            } else { 
                this.ks = null; this.ksPos = 0; 
            } 
            return o; 
        }
        if (st === 'cfb') { 
            const ak = await (this.ak ??= crypto.subtle.importKey('raw', this.key, { name: 'AES-CBC' }, false, ['encrypt']));
            const o = new Uint8Array(d.length); 
            let di = 0; 
            while (di < d.length && this.ks && this.ksPos < 16) { 
                const ct = d[di] ^ this.ks[this.ksPos]; 
                o[di] = ct; 
                this.iv[this.ksPos] = this.isEnc ? ct : d[di]; 
                di++; this.ksPos++; 
            } 
            while (di + 16 <= d.length) { 
                const e = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: Z16_ss }, ak, this._cfbBlk())).subarray(0, 16); 
                for (let j = 0; j < 16; j++) { 
                    o[di + j] = d[di + j] ^ e[j]; 
                    this.iv[j] = this.isEnc ? o[di + j] : d[di + j]; 
                } 
                di += 16; 
            } 
            if (di < d.length) { 
                this.ks = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: Z16_ss }, ak, this._cfbBlk())).subarray(0, 16); 
                this.ksPos = 0; 
                while (di < d.length) { 
                    const ct = d[di] ^ this.ks[this.ksPos]; 
                    o[di] = ct; 
                    this.iv[this.ksPos] = this.isEnc ? ct : d[di]; 
                    di++; this.ksPos++; 
                } 
            } else { 
                this.ks = null; this.ksPos = 0; 
            } 
            return o; 
        }
        if (st === 'rc4') { 
            if (!this.rc4s) { 
                const rk = await md5Digest_ss(new Uint8Array([...this.key, ...this.iv])); 
                this.rc4s = new Uint8Array(256); 
                for (let i = 0; i < 256; i++) this.rc4s[i] = i; 
                let j = 0; 
                for (let i = 0; i < 256; i++) { 
                    j = (j + this.rc4s[i] + rk[i % rk.length]) & 255; 
                    [this.rc4s[i], this.rc4s[j]] = [this.rc4s[j], this.rc4s[i]]; 
                } 
            } 
            const o = new Uint8Array(d.length); 
            let x = this.rc4i, j = this.rc4j; 
            for (let k = 0; k < d.length; k++) { 
                x = (x + 1) & 255; 
                j = (j + this.rc4s[x]) & 255; 
                [this.rc4s[x], this.rc4s[j]] = [this.rc4s[j], this.rc4s[x]]; 
                o[k] = d[k] ^ this.rc4s[(this.rc4s[x] + this.rc4s[j]) & 255]; 
            } 
            this.rc4i = x; this.rc4j = j; 
            return o; 
        } 
        return d; 
    } 
}

class SS_Engine { 
    constructor(cfg) { 
        this.cfg = cfg || {};
        this.I = C_SS[this.cfg.method] || C_SS['none'];
        this.dec = null; 
        this.enc = null; 
        this.mk = null; 
        this.buf = new Uint8Array(0); 
        this.plen = -1; 
        this.hdr = false; 
        this.sdec = null; 
        this.senc = null; 
        this.csalt = null; 
    }
    async init() { 
        const I = this.I;
        if (I.none) return;
        if (I.b3) {
            try { 
                this.mk = Uint8Array.from(atob(this.cfg.psk), c => c.charCodeAt(0)); 
            } catch { 
                this.mk = enc_ss.encode(this.cfg.psk).slice(0, I.k); 
            }
        } else {
            this.mk = await evp_ss(this.cfg.psk || this.cfg.pw, I.k);
        }
    }
    async decData(data) { 
        const I = this.I;
        this.buf = pushBuf_ss(this.buf, data); 
        const out = [];
        if (I.none) { 
            const r = this.buf; 
            this.buf = new Uint8Array(0); 
            return { c: [r] }; 
        }
        if (I.s) { 
            if (!this.sdec) { 
                if (this.buf.length < I.iv) return { c: [] }; 
                this.sdec = new Strm_SS(this.mk, this.buf.slice(0, I.iv), I, false); 
                this.buf = this.buf.slice(I.iv); 
            } 
            if (this.buf.length > 0) { 
                const d = await this.sdec.crypt(this.buf); 
                this.buf = new Uint8Array(0); 
                return { c: [d] }; 
            } 
            return { c: [] }; 
        }
        if (!this.dec) { 
            if (this.buf.length < I.iv) return { c: [] }; 
            const salt = this.buf.slice(0, I.iv); 
            this.buf = this.buf.slice(I.iv); 
            if (I.b3) this.csalt = salt; 
            this.dec = new AEAD_SS(await sesKey_ss(this.mk, salt, I), I); 
            await this.dec.init(); 
        }
        if (I.b3 && !this.hdr) { 
            const fhs = 11 + I.tag; 
            if (this.buf.length < fhs) return { c: [] }; 
            const fh = await this.dec.dec(this.buf.slice(0, fhs)); 
            if (!fh) return { c: [], e: 'fhdr' }; 
            this.buf = this.buf.slice(fhs); 
            if (fh[0] !== 0) return { c: [], e: 'type' }; 
            const vl = u16be_ss(fh, 9), vhs = vl + I.tag; 
            if (this.buf.length < vhs) { 
                this.plen = vl; 
                return { c: [] }; 
            } 
            const vh = await this.dec.dec(this.buf.slice(0, vhs)); 
            if (!vh) return { c: [], e: 'vhdr' }; 
            this.buf = this.buf.slice(vhs); 
            this.hdr = true; 
            let al = 0; 
            if (vh[0] === 1) al = 7; 
            else if (vh[0] === 3) al = 4 + vh[1]; 
            else if (vh[0] === 4) al = 19; 
            else return { c: [], e: 'addr' }; 
            const pl = u16be_ss(vh, al), ps = al + 2 + pl, res = new Uint8Array(al + (vh.length - ps)); 
            res.set(vh.slice(0, al)); 
            if (vh.length > ps) res.set(vh.slice(ps), al); 
            out.push(res); 
            this.plen = -1; 
        }
        while (true) { 
            if (this.plen < 0) { 
                const ls = 2 + I.tag; 
                if (this.buf.length < ls) break; 
                const lp = await this.dec.dec(this.buf.slice(0, ls)); 
                if (!lp) return { c: out, e: 'len' }; 
                this.plen = u16be_ss(lp, 0); 
                this.buf = this.buf.slice(ls); 
            } 
            const ps = this.plen + I.tag; 
            if (this.buf.length < ps) break; 
            const pp = await this.dec.dec(this.buf.slice(0, ps)); 
            if (!pp) return { c: out, e: 'pay' }; 
            out.push(pp); 
            this.buf = this.buf.slice(ps); 
            this.plen = -1; 
        } 
        return { c: out }; 
    }
    async encData(data) { 
        const I = this.I;
        if (I.none) return data;
        if (I.s) { 
            let pf = new Uint8Array(0); 
            if (!this.senc) { 
                const iv = crypto.getRandomValues(new Uint8Array(I.iv)); 
                this.senc = new Strm_SS(this.mk, iv, I, true); 
                pf = iv; 
            } 
            const e = await this.senc.crypt(data); 
            return cat_ss(pf, e); 
        }
        let pf = new Uint8Array(0); 
        if (!this.enc) { 
            const salt = crypto.getRandomValues(new Uint8Array(I.iv)); 
            this.enc = new AEAD_SS(await sesKey_ss(this.mk, salt, I), I); 
            await this.enc.init();
            if (I.b3) { 
                const fhLen = 11 + I.k, fh = new Uint8Array(fhLen); 
                fh[0] = 1; 
                new DataView(fh.buffer).setBigUint64(1, BigInt(Math.floor(Date.now() / 1000)), false); 
                if (this.csalt) fh.set(this.csalt, 9); 
                const ipl = Math.min(data.length, 0xFFFF); 
                new DataView(fh.buffer).setUint16(9 + I.k, ipl, false); 
                const efh = await this.enc.enc(fh), eip = await this.enc.enc(data.slice(0, ipl)); 
                pf = cat_ss(salt, efh, eip); 
                data = data.slice(ipl); 
                if (data.length === 0) return pf; 
            } else {
                pf = salt; 
            }
        }
        const mx = 0x3FFF, cks = []; 
        for (let i = 0; i < data.length; i += mx) { 
            const ck = data.subarray(i, Math.min(i + mx, data.length));
            const lb = new Uint8Array(2); 
            put16_ss(lb, 0, ck.length); 
            cks.push(await this.enc.enc(lb), await this.enc.enc(ck)); 
        } 
        const tl = pf.length + cks.reduce((s, c) => s + c.length, 0);
        const r = new Uint8Array(tl); 
        r.set(pf); 
        let o = pf.length; 
        for (const c of cks) { 
            r.set(c, o); 
            o += c.length; 
        } 
        return r; 
    } 
}

const parseSSAddr = d => { 
    if (d.length < 1) return null; 
    const t = d[0]; 
    let h, p, o; 
    if (t === 1) { 
        if (d.length < 7) return null; 
        h = `${d[1]}.${d[2]}.${d[3]}.${d[4]}`; 
        p = u16be_ss(d, 5); 
        o = 7; 
    } else if (t === 3) { 
        const l = d[1]; 
        if (d.length < 4 + l) return null; 
        h = dec_ss.decode(d.slice(2, 2 + l)); 
        p = u16be_ss(d, 2 + l); 
        o = 4 + l; 
    } else if (t === 4) { 
        if (d.length < 19) return null; 
        const pts = []; 
        for (let i = 0; i < 8; i++) pts.push(((d[1 + i * 2] << 8) | d[2 + i * 2]).toString(16)); 
        h = pts.join(':'); 
        p = u16be_ss(d, 17); 
        o = 19; 
    } else return null; 
    return { h, p, o, addressType: t }; 
};

async function deriveSS_Psk(pw, requiredLen) {
    if (!pw) return '';
    try {
        const decoded = atob(String(pw).trim());
        if (decoded.length === requiredLen) {
            return String(pw).trim();
        }
    } catch (e) {}
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc_ss.encode(String(pw))));
    const keyBytes = hash.slice(0, requiredLen);
    let binary = '';
    for (let i = 0; i < keyBytes.length; i++) {
        binary += String.fromCharCode(keyBytes[i]);
    }
    return btoa(binary);
}

const GRAIN_CFG = {
    chunk: 64 * 1024,
    dnPack: 32 * 1024,
    dnTail: 512,
    dnQr: 4,
    upPack: 20 * 1024,
    concur: 2
};

function uuidToBytes(uuidStr) {
    if (!uuidStr || typeof uuidStr !== 'string') return null;
    const clean = uuidStr.replace(/-/g, '').toLowerCase();
    if (clean.length !== 32) return null;
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        const val = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
        if (isNaN(val)) return null;
        bytes[i] = val;
    }
    return bytes;
}

function matchUUID(chunkBytes, offset, uuidBytes) {
    if (!uuidBytes || chunkBytes.length < offset + 16) return false;
    for (let i = 0; i < 16; i++) {
        if (chunkBytes[offset + i] !== uuidBytes[i]) return false;
    }
    return true;
}

yourUUIDBytes = uuidToBytes(yourUUID);

function getSocketConnector(request) {
    if (request && request.fetcher && typeof request.fetcher.connect === 'function') {
        return request.fetcher;
    }
    return { connect };
}

const sprout = (f, h, p) => {
    try {
        const s = f.connect({ hostname: h, port: p });
        if (s && s.opened && typeof s.opened.then === 'function') {
            return s.opened.then(() => s);
        }
        return Promise.resolve(s);
    } catch (e) {
        return Promise.reject(e);
    }
};

const raceSprout = (f, h, p, concur = 2) => {
    if (!f || typeof f.connect !== 'function') {
        return Promise.reject(new Error('connect unavailable'));
    }
    if (concur <= 1) return sprout(f, h, p);
    // Happy Eyeballs 阶梯竞速：先发 1 路，若 220ms 未握手完成或提前失败再补发第 2 路，大幅节省连接配额
    return new Promise((resolve, reject) => {
        let settled = false;
        let timer = 0;
        let startedSecond = false;
        let failedCount = 0;
        let totalStarted = 1;
        let lastErr = null;
        const onWin = sock => {
            if (settled) {
                closeSocketQuietly(sock);
                return;
            }
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(sock);
        };
        const onFail = err => {
            lastErr = err;
            failedCount++;
            if (!settled && !startedSecond) {
                if (timer) clearTimeout(timer);
                launchBackup();
                return;
            }
            if (!settled && failedCount >= totalStarted) {
                settled = true;
                if (timer) clearTimeout(timer);
                reject(lastErr || new Error('Connection failed'));
            }
        };
        const launchBackup = () => {
            if (settled || startedSecond) return;
            startedSecond = true;
            totalStarted = 2;
            sprout(f, h, p).then(onWin, onFail);
        };
        timer = setTimeout(launchBackup, 220);
        sprout(f, h, p).then(onWin, onFail);
    });
};

const mkK = (cap, cpy = 0) => {
    let q = [], h = 0, b = 0, buf = null;
    const e = () => h >= q.length;
    const trim = () => { if (h > 32 && h * 2 >= q.length) { q = q.slice(h); h = 0; } };
    const clear = () => { q = []; h = 0; b = 0; };
    const take = () => { if (e()) return null; const d = q[h]; q[h++] = undefined; b -= d.byteLength; trim(); return d; };
    const sow = d => { const n = d?.byteLength || 0; return !n || (q.push(d), b += n, 1); };
    const pack = d => {
        d ||= take();
        if (!d || e()) return [d, 0];
        let n = d.byteLength, j = h;
        while (j < q.length) {
            const x = q[j], nn = n + x.byteLength;
            if (nn > cap) break;
            n = nn;
            j++;
        }
        if (j === h) return [d, 0];
        const out = buf ||= new Uint8Array(cap);
        out.set(d);
        for (let o = d.byteLength; h < j;) {
            const x = q[h];
            q[h++] = undefined;
            b -= x.byteLength;
            out.set(x, o);
            o += x.byteLength;
        }
        trim();
        const u = out.subarray(0, n);
        return [cpy ? u.slice() : u, 1];
    };
    return { e, get b() { return b; }, clear, take, sow, pack };
};

const mkQ = cap => {
    const k = mkK(cap);
    return { get empty() { return k.e(); }, clear: k.clear, sow: k.sow, bundle: d => k.pack(d) };
};

const mkDn = (w, sendFn) => {
    const cap = GRAIN_CFG.dnPack;
    const tail = GRAIN_CFG.dnTail;
    const low = Math.max(4096, tail * 12);
    const k = mkK(cap, 1);
    let tp = 0, gen = 0, qk = 0, qr = 0;
    let reaping = false;
    
    const reap = async () => {
        if (tp) clearTimeout(tp);
        tp = 0;
        qr = 0;
        if (reaping) return;
        reaping = true;
        try {
            for (;;) {
                const [u] = k.pack();
                if (!u) break;
                await sendFn(u);
            }
        } finally {
            reaping = false;
        }
    };
    
    const ripen = () => {
        if (k.e() || tp) return;
        if (k.b >= cap || (cap - k.b) < tail) return reap();
        tp = setTimeout(async () => {
            tp = 0;
            if (k.e()) return;
            if (k.b >= cap || (cap - k.b) < tail) return reap();
            if (qr < GRAIN_CFG.dnQr && (gen !== qk || k.b < low)) {
                qr++;
                qk = gen;
                return ripen();
            }
            await reap();
        }, 1);
    };
    
    return {
        send(u) {
            let o = 0, n = u?.byteLength || 0;
            if (!n) return;
            while (o < n) {
                const m = Math.min(cap - k.b, n - o);
                if (!m) { reap(); continue; }
                k.sow(o || m !== n ? u.subarray(o, o + m) : u);
                gen++;
                o += m;
                if (k.b >= cap || (cap - k.b) < tail) reap();
                else ripen();
            }
        },
        reap
    };
};

function formatIdentifier(arr, offset = 0) {
    const hex = [...arr.slice(offset, offset + 16)].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.substring(0,8)}-${hex.substring(8,12)}-${hex.substring(12,16)}-${hex.substring(16,20)}-${hex.substring(20)}`;
}

function base64ToArray(b64Str) {
    if (!b64Str) return { error: null };
    try { 
        const binaryString = atob(b64Str.replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return { earlyData: bytes.buffer, error: null }; 
    } catch (error) { 
        // 非 base64（如普通子协议名）时视为无早期数据，不中断连接
        return { error: null }; 
    }
}

/**
 * 解析并合并优选 IP 列表 (支持纯文本 IP/域名以及远程 Gist / http(s) 链接自动拉取合并)
 * @param {string[]} cfipList
 * @returns {Promise<string[]>}
 */
async function resolveCfipList(cfipList) {
    if (!Array.isArray(cfipList) || cfipList.length === 0) return ['www.visa.com.tw'];
    const resolved = [];
    for (const item of cfipList) {
        const trimmed = String(item).trim();
        if (!trimmed || trimmed.startsWith('//')) continue;
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            try {
                const resp = await fetch(trimmed, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare-Worker)' },
                    signal: controller.signal
                });
                if (resp.ok) {
                    const text = await resp.text();
                    const lines = text.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
                    for (const line of lines) {
                        if (line && !line.startsWith('#') && !line.startsWith('//')) {
                            resolved.push(line);
                        }
                    }
                }
            } catch (err) {
                // 网络异常或超时自动跳过
            } finally {
                clearTimeout(timer);
            }
        } else {
            resolved.push(trimmed);
        }
    }
    return resolved.length > 0 ? resolved : ['www.visa.com.tw'];
}

function parsePryAddress(serverStr) {
    if (!serverStr) return null;
    serverStr = String(serverStr).split('#')[0].replace(/^(?:ld|fd|proxyip)=/i, '').trim();
    if (!serverStr) return null;
    // 解析 SSTP (MS-SSTP / SoftEther)
    if (serverStr.startsWith('sstp://')) {
        try {
            const url = new URL(serverStr);
            return {
                type: 'sstp',
                host: url.hostname,
                port: parseInt(url.port) || 443,
                username: url.username ? decodeURIComponent(url.username) : 'vpn',
                password: url.password ? decodeURIComponent(url.password) : 'vpn'
            };
        } catch (e) {
            return null;
        }
    }

    // 解析 TURN (RFC 5766 / RFC 6062)
    if (serverStr.startsWith('turn://')) {
        try {
            const url = new URL(serverStr);
            return {
                type: 'turn',
                host: url.hostname,
                port: parseInt(url.port) || 3478,
                username: url.username ? decodeURIComponent(url.username) : '',
                password: url.password ? decodeURIComponent(url.password) : ''
            };
        } catch (e) {
            return null;
        }
    }

    // 解析 S5
    if (serverStr.startsWith('socks://') || serverStr.startsWith('socks5://')) {
        const urlStr = serverStr.replace(/^socks:\/\//, 'socks5://');
        try {
            const url = new URL(urlStr);
            return {
                type: 'socks5',
                host: url.hostname,
                port: parseInt(url.port) || 1080,
                username: url.username ? decodeURIComponent(url.username) : '',
                password: url.password ? decodeURIComponent(url.password) : ''
            };
        } catch (e) {
            return null;
        }
    }
    
    // 解析 HTTP / HTTPS
    if (serverStr.startsWith('http://') || serverStr.startsWith('https://')) {
        const isHttps = serverStr.startsWith('https://');
        try {
            const url = new URL(serverStr);
            const hostname = url.hostname.replace(/^\[|\]$/g, '');
            return {
                type: isHttps ? 'https' : 'http',
                host: hostname,
                port: parseInt(url.port) || (isHttps ? 443 : 80),
                username: url.username ? decodeURIComponent(url.username) : '',
                password: url.password ? decodeURIComponent(url.password) : '',
                // 可选：https://user:pass@1.2.3.4:443?sni=proxy.example.com  用 IP 连接但按域名做 TLS 校验
                sni: url.searchParams.get('sni') || url.searchParams.get('servername') || url.searchParams.get('host') || '',
                // 可选：[REDACTED_CONN_STRING]://1.2.3.4:443?insecure  跳过证书校验（自签 / IP / 证书不匹配）
                insecure: isHttps && /^(?:1|true|yes|)$/i.test(url.searchParams.get('insecure') ?? url.searchParams.get('allowInsecure') ?? 'no')
            };
        } catch (e) {
            return null;
        }
    }
    
    // 处理 IPv6 格式 [host]:port
    if (serverStr.startsWith('[')) {
        const closeBracket = serverStr.indexOf(']');
        if (closeBracket > 0) {
            const host = serverStr.substring(1, closeBracket);
            const rest = serverStr.substring(closeBracket + 1);
            if (rest.startsWith(':')) {
                const port = parseInt(rest.substring(1), 10);
                if (!isNaN(port) && port > 0 && port <= 65535) {
                    return { type: 'direct', host, port };
                }
            }
            return { type: 'direct', host, port: 443 };
        }
    }

    // 不带中括号的纯 IPv6（如 2001:db8::1），整体视为主机，端口默认 443
    if ((serverStr.match(/:/g) || []).length >= 2) {
        return { type: 'direct', host: serverStr, port: 443 };
    }

    const lastColonIndex = serverStr.lastIndexOf(':');
    
    if (lastColonIndex > 0) {
        const host = serverStr.substring(0, lastColonIndex);
        const portStr = serverStr.substring(lastColonIndex + 1);
        const port = parseInt(portStr, 10);
        
        if (!isNaN(port) && port > 0 && port <= 65535) {
            return { type: 'direct', host, port };
        }
    }
    
    return { type: 'direct', host: serverStr, port: 443 };
}


async function sha224(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  let H = [0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939,0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4];
  const msgLen = data.length;
  const bitLen = msgLen * 8;
  const paddedLen = Math.ceil((msgLen + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[msgLen] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen, false);
  for (let chunk = 0; chunk < paddedLen; chunk += 64) {
    const W = new Uint32Array(64);
    
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(chunk + i * 4, false);
    }
    
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(W[i - 15], 7) ^ rightRotate(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rightRotate(W[i - 2], 17) ^ rightRotate(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    
    let [a, b, c, d, e, f, g, h] = H;
    
    for (let i = 0; i < 64; i++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  
  const result = [];
  for (let i = 0; i < 7; i++) {
    result.push(
      ((H[i] >>> 24) & 0xff).toString(16).padStart(2, '0'),
      ((H[i] >>> 16) & 0xff).toString(16).padStart(2, '0'),
      ((H[i] >>> 8) & 0xff).toString(16).padStart(2, '0'),
      (H[i] & 0xff).toString(16).padStart(2, '0')
    );
  }
  return result.join('');
}

function rightRotate(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

// ------------------------- 安全响应头 -------------------------
const CSP_HTML = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
    "font-src 'self' data: https://cdnjs.cloudflare.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'"
].join('; ');
function withSecurityHeaders(resp) {
    // WebSocket 升级响应(101)不能改，原样返回
    if (!resp || resp.status === 101 || resp.webSocket) return resp;
    const h = new Headers(resp.headers);
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'no-referrer');
    h.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    h.set('X-Frame-Options', 'DENY');
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if ((h.get('Content-Type') || '').includes('text/html')) {
        h.set('Content-Security-Policy', CSP_HTML);
    }
    if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

const workerApp = {
	/**
	 * @param {import("@cloudflare/workers-types").Request} request
	 * @param {{UUID: string, uuid: string, PROXYIP: string, PASSWORD: string, PASSWD: string, password: string, proxyip: string, proxyIP: string, SUB_PATH: string, subpath: string, DISABLE_TROJAN: string, CLOSE_TROJAN: string}} env
	 * @param {import("@cloudflare/workers-types").ExecutionContext} ctx
	 * @returns {Promise<Response>}
	 */
    async fetch(request, env, ctx) {
        try {
            const config = await loadConfig(env);
            const kv = getKV(env);
            const hasKV = !!kv;

            if (config.yourUUID !== cachedUUIDStr) {
                cachedUUIDStr = config.yourUUID;
                cachedUUIDBytes = uuidToBytes(config.yourUUID);
                cachedTrojanHash = await sha224(config.yourUUID);
            }
            yourUUID = config.yourUUID;
            yourUUIDBytes = cachedUUIDBytes;
            password = config.password;
            subPath = config.subPath;
            proxyIP = config.proxyIP;
            proxyIPs = config.proxyIPs;
            landingProxy = config.landingProxy;
            landingProxies = config.landingProxies;
            disablevless = config.disablevless;
            disabletro = config.disabletro;
            disabless = config.disabless;
            ssMethod = config.ssMethod;
            ssPsk = config.ssPsk;
            SSpath = config.SSpath;
            cfip = config.cfip;

            const currentSSpath = config.SSpath || config.yourUUID;
            const validSSPath = `/${currentSSpath}`;
            
            const url = new URL(request.url);
            const pathname = url.pathname;
            
            // 1. 后台配置 API: /api/config (需后台管理员密码 ADMIN 鉴权)
            if (pathname === '/api/config') {
                if (isLoginLocked(request)) {
                    return new Response(JSON.stringify({ success: false, message: '尝试次数过多，请 15 分钟后再试' }), { status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
                }
                if (!(await isAdminAuthed(request, config))) {
                    if (request.headers.get('x-password') !== null) recordLoginFail(request);
                    return new Response(JSON.stringify({ success: false, message: '后台管理鉴权失败，密码错误' }), {
                        status: 401,
                        headers: { 'Content-Type': 'application/json; charset=utf-8' }
                    });
                }
                if (request.method === 'POST') {
                    if (!hasKV) {
                        return new Response(JSON.stringify({ success: false, message: '未绑定 KV 存储，无法保存配置' }), {
                            status: 400,
                            headers: { 'Content-Type': 'application/json; charset=utf-8' }
                        });
                    }
                    try {
                        const body = await request.json();
                        let newCfip = [];
                        if (typeof body.cfip === 'string') {
                            newCfip = body.cfip.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
                        } else if (Array.isArray(body.cfip)) {
                            newCfip = body.cfip.map(s => String(s).trim()).filter(Boolean);
                        }
                        let newProxyIPs = [];
                        let hasProxyInput = false;
                        if (typeof body.proxyIPs === 'string') {
                            hasProxyInput = true;
                            newProxyIPs = body.proxyIPs.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
                        } else if (Array.isArray(body.proxyIPs)) {
                            hasProxyInput = true;
                            newProxyIPs = body.proxyIPs.map(s => String(s).trim()).filter(Boolean);
                        } else if (typeof body.proxyIP === 'string') {
                            hasProxyInput = true;
                            newProxyIPs = body.proxyIP.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
                        }
                        const finalProxyIPs = hasProxyInput ? newProxyIPs : config.proxyIPs;
                        const mainProxyIP = finalProxyIPs.length > 0 ? finalProxyIPs[0] : '';

                        let newLandingProxies = Array.isArray(config.landingProxies) ? [...config.landingProxies] : [];
                        if (typeof body.landingProxies === 'string') {
                            newLandingProxies = body.landingProxies.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
                        } else if (Array.isArray(body.landingProxies)) {
                            newLandingProxies = body.landingProxies.map(s => String(s).trim()).filter(Boolean);
                        } else if (typeof body.landingProxy === 'string') {
                            newLandingProxies = body.landingProxy.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
                        }
                        const mainLandingProxy = newLandingProxies.length > 0 ? newLandingProxies[0] : '';
                        
                        const updatedConfig = {
                            yourUUID: (body.yourUUID && String(body.yourUUID).trim()) || config.yourUUID,
                            adminPassword: (body.adminPassword && String(body.adminPassword).trim()) || config.adminPassword,
                            subPath: body.subPath !== undefined ? String(body.subPath).trim() : config.subPath,
                            subToken: body.subToken !== undefined ? String(body.subToken).trim() : (config.subToken || ''),
                            proxyIP: mainProxyIP,
                            proxyIPs: finalProxyIPs,
                            landingProxy: mainLandingProxy,
                            landingProxies: newLandingProxies,
                            disablevless: body.disablevless === true || body.disablevless === 'true',
                            disabletro: body.disabletro === true || body.disabletro === 'true',
                            disabless: body.disabless === true || body.disabless === 'true',
                            ssMethod: body.ssMethod ? String(body.ssMethod).trim() : (config.ssMethod || 'aes-256-gcm'),
                            ssPsk: body.ssPsk !== undefined ? String(body.ssPsk).trim() : (config.ssPsk || ''),
                            SSpath: body.SSpath !== undefined ? String(body.SSpath).trim() : config.SSpath,
                            cfip: body.cfip !== undefined ? newCfip : config.cfip,
                            clashSubUrl: body.clashSubUrl !== undefined ? String(body.clashSubUrl).trim() : config.clashSubUrl,
                            singboxSubUrl: body.singboxSubUrl !== undefined ? String(body.singboxSubUrl).trim() : config.singboxSubUrl
                        };
                        await saveConfig(env, updatedConfig);
                        const secureFlag = url.protocol === 'https:' ? '; Secure' : '';
                        return new Response(JSON.stringify({ success: true, message: '配置已成功持久化保存到 Cloudflare KV！' }), {
                            headers: {
                                'Content-Type': 'application/json; charset=utf-8',
                                'Set-Cookie': authCookie('cf_admin_pwd', await makeAuthToken('admin', updatedConfig.adminPassword), secureFlag)
                            }
                        });
                    } catch (err) {
                        return new Response(JSON.stringify({ success: false, message: '保存失败: ' + err.message }), {
                            status: 500,
                            headers: { 'Content-Type': 'application/json; charset=utf-8' }
                        });
                    }
                } else if (request.method === 'GET') {
                    return new Response(JSON.stringify({ success: true, config: sanitizeConfig(config), hasKV }), {
                        headers: { 'Content-Type': 'application/json; charset=utf-8' }
                    });
                }
            }

            // 2. 后台重置 API: /api/reset (需后台管理员密码 ADMIN 鉴权)
            if (pathname === '/api/reset' && request.method === 'POST') {
                if (isLoginLocked(request)) {
                    return new Response(JSON.stringify({ success: false, message: '尝试次数过多，请 15 分钟后再试' }), { status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
                }
                if (!(await isAdminAuthed(request, config))) {
                    if (request.headers.get('x-password') !== null) recordLoginFail(request);
                    return new Response(JSON.stringify({ success: false, message: '后台管理鉴权失败，密码错误' }), {
                        status: 401,
                        headers: { 'Content-Type': 'application/json; charset=utf-8' }
                    });
                }
                if (!hasKV) {
                    return new Response(JSON.stringify({ success: false, message: '未绑定 KV 存储，无法重置' }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json; charset=utf-8' }
                    });
                }
                await resetConfig(env);
                const resetCfg = await loadConfig(env);
                const secureFlag = url.protocol === 'https:' ? '; Secure' : '';
                const resetCookie = authCookie('cf_admin_pwd', await makeAuthToken('admin', resetCfg.adminPassword), secureFlag);
                return new Response(JSON.stringify({ success: true, message: '已清除 KV 配置，恢复默认设置！' }), {
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Set-Cookie': resetCookie
                    }
                });
            }

            // 3. WebSocket 连接

            // 3. 登录：POST 表单提交密码，签发签名 Cookie 后 303 跳回
            if (request.method === 'POST' && (pathname === '/' || pathname === '/admin' || pathname === '/admin/')) {
                const isAdminLogin = pathname !== '/';
                const secureFlag = url.protocol === 'https:' ? '; Secure' : '';
                const host = request.headers.get('Host') || url.host;
                if (isLoginLocked(request)) {
                    return new Response('尝试次数过多，请 15 分钟后再试', { status: 429, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
                }
                let pwd = '';
                try {
                    const ct = request.headers.get('Content-Type') || '';
                    if (ct.includes('application/json')) pwd = String((await request.json()).password || '');
                    else pwd = String((await request.formData()).get('password') || '');
                } catch (e) {}
                const secret = isAdminLogin ? config.adminPassword : (config.subToken || config.adminPassword);
                if (pwd && safeEqual(pwd, secret)) {
                    clearLoginFail(request);
                    const cookieName = isAdminLogin ? 'cf_admin_pwd' : 'cf_user_pwd';
                    const token = await makeAuthToken(isAdminLogin ? 'admin' : 'user', secret);
                    return new Response(null, { status: 303, headers: { 'Location': isAdminLogin ? '/admin' : '/', 'Set-Cookie': authCookie(cookieName, token, secureFlag), 'Cache-Control': 'no-store' } });
                }
                recordLoginFail(request);
                return isAdminLogin
                    ? getLoginPage(host, `https://${host}`, true, true)
                    : getCamouflageProbePage(host, true, true);
            }

            if (request.headers.get('Upgrade') === 'websocket') {
                // 路径中 proxyip / fd (分流代理) / ld (落地代理) 提取 (支持 sstp://, turn://, socks5://, http(s)://)
                let pathProxyIP = null;
                const proxyIpMatch = pathname.match(/\/(?:proxyip|fd|ld)=((?:sstp|turn|socks5|socks|https|http):\/\/[^\s?&#]+)/i) ||
                                     pathname.match(/^\/((?:sstp|turn):\/\/[^\s?&#]+)/i) ||
                                     pathname.match(/\/(?:proxyip|fd|ld)=([^/?&#]+)/i);
                if (proxyIpMatch) {
                    try {
                        pathProxyIP = decodeURIComponent(proxyIpMatch[1]).trim();
                    } catch (e) {}
                } else if (pathname.startsWith('/proxyip=')) {
                    try { pathProxyIP = decodeURIComponent(pathname.substring(9)).trim(); } catch (e) {}
                } else if (pathname.startsWith('/fd=')) {
                    try { pathProxyIP = decodeURIComponent(pathname.substring(4)).trim(); } catch (e) {}
                } else if (pathname.startsWith('/ld=')) {
                    try { pathProxyIP = decodeURIComponent(pathname.substring(4)).trim(); } catch (e) {}
                }
                // 1. 标准提取 (从 URL 查询参数或 Headers 中获取)
                let reqLd = url.searchParams.get('ld') || request.headers.get('ld');
                let reqFd = url.searchParams.get('fd') || request.headers.get('fd') || url.searchParams.get('proxyip') || request.headers.get('proxyip');

                // 2. 原始请求 URL 深度解码与正则兜底
                // 兼容部分客户端对 ?, &, = 等字符进行 URL 编码的情况 (如 Trojan 在部分客户端下发送 /%3Fed=2560%26ld=3)
                if (!reqLd && !reqFd) {
                    let rawUrl = '';
                    try {
                        rawUrl = decodeURIComponent(request.url);
                    } catch (e) {
                        rawUrl = request.url || '';
                    }
                    const ldMatch = rawUrl.match(/[?&;/]ld=((?:sstp|turn|socks5|socks|https|http):\/\/[^\s?&#]+(?:\?(?:sni|insecure|allowInsecure)(?:=[^\s&#/]*)?(?:&(?:sni|insecure|allowInsecure)(?:=[^\s&#/]*)?)*)?)/i) ||
                                    rawUrl.match(/[?&;/]ld=([^/?&#\s]+)/i);
                    if (ldMatch) reqLd = ldMatch[1].trim();

                    const fdMatch = rawUrl.match(/[?&;/](?:fd|proxyip)=((?:sstp|turn|socks5|socks|https|http):\/\/[^\s?&#]+)/i) ||
                                    rawUrl.match(/[?&;/](?:fd|proxyip)=([^/?&#\s]+)/i);
                    if (fdMatch) reqFd = fdMatch[1].trim();
                }

                let customProxyIP = pathProxyIP || reqLd || reqFd;

                // 区分索引来源：是 ld 还是 fd
                if (customProxyIP && /^\d+$/.test(customProxyIP.trim())) {
                    const idx = parseInt(customProxyIP.trim(), 10);
                    let targetList = [];
                    if (reqLd || (pathProxyIP && pathname.includes('/ld='))) {
                        targetList = (Array.isArray(config.landingProxies) && config.landingProxies.length > 0)
                            ? config.landingProxies
                            : (config.landingProxy ? [config.landingProxy] : []);
                    } else {
                        targetList = (Array.isArray(config.proxyIPs) && config.proxyIPs.length > 0)
                            ? config.proxyIPs
                            : (config.proxyIP ? [config.proxyIP] : []);
                    }
                    if (targetList[idx]) {
                        let raw = targetList[idx].trim();
                        if (raw.includes('#')) raw = raw.split('#')[0].trim();
                        customProxyIP = raw.replace(/^(?:ld|fd|proxyip)=/i, '').trim();
                    } else {
                        // 序号越界：忽略，回退到全局配置
                        customProxyIP = '';
                    }
                }

                // 若请求未显式指定落地代理或反代，执行全局互斥决策：全局落地代理优先 > 反代
                if (!customProxyIP) {
                    const landingList = (Array.isArray(config.landingProxies) && config.landingProxies.length > 0)
                        ? config.landingProxies
                        : (config.landingProxy ? [config.landingProxy] : []);
                    if (landingList.length > 0 && landingList[0]) {
                        let raw = landingList[0].trim();
                        if (raw.includes('#')) raw = raw.split('#')[0].trim();
                        customProxyIP = raw.replace(/^(?:ld|fd|proxyip)=/i, '').trim();
                    } else {
                        const proxyList = (Array.isArray(config.proxyIPs) && config.proxyIPs.length > 0)
                            ? config.proxyIPs
                            : (config.proxyIP ? [config.proxyIP] : []);
                        if (proxyList.length > 0 && proxyList[0]) {
                            let raw = proxyList[0].trim();
                            if (raw.includes('#')) raw = raw.split('#')[0].trim();
                            customProxyIP = raw.replace(/^(?:ld|fd|proxyip)=/i, '').trim();
                        }
                    }
                }
                return await handleVlsRequest(request, customProxyIP, validSSPath, config);
            } else if (request.method === 'GET') {
                // 5. 后台管理页面 (/admin - 需 ADMIN 密码验证)
                if (url.pathname === '/admin' || url.pathname === '/admin/') {
                    return await getAdminPage(request, validSSPath, config, hasKV);
                }

                // 6. 前台节点与订阅页面 (/ - 需 PASSWORD 密码验证)
                if (url.pathname === '/') {
                    return await getNodesPage(request, validSSPath, config, hasKV);
                }
                
                // 7. 订阅输出 (支持 Base64 通用 / Sing-box 1.14 JSON / FlClash & 原版 Clash 双模 YAML)
                const cleanReqPath = url.pathname.replace(/\/+$/, '').toLowerCase();
                const cleanSubPath = `/${config.subPath.replace(/^\/+|\/+$/g, '').toLowerCase()}`;
                if (cleanReqPath === cleanSubPath) {
                    // 订阅 token 校验：设置了 SUB_TOKEN 时必须带 ?token=，否则伪装 404
                    if (config.subToken && !safeEqual(url.searchParams.get('token') || '', config.subToken)) {
                        return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
                    }
                    const currentDomain = url.hostname;
                    const allNodes = await buildAllNodes(config, currentDomain, validSSPath);
                    const filterType = (url.searchParams.get('type') || '').toLowerCase();
                    let filteredNodes = allNodes;
                    if (filterType === 'ss' || filterType === 'shadowsocks') {
                        filteredNodes = allNodes.filter(n => n.protocol === 'ss');
                    } else if (filterType === 'vless') {
                        filteredNodes = allNodes.filter(n => n.protocol === 'vless');
                    } else if (filterType === 'trojan') {
                        filteredNodes = allNodes.filter(n => n.protocol === 'trojan');
                    }

                    const targetFmt = (url.searchParams.get('target') || url.searchParams.get('format') || '').toLowerCase();
                    if (targetFmt === 'singbox' || targetFmt === 'sing-box') {
                        const sbJson = generateSingboxConfig(filteredNodes);
                        return new Response(JSON.stringify(sbJson, null, 2), {
                            headers: {
                                'Content-Type': 'application/json; charset=utf-8',
                                'Content-Disposition': "attachment; filename*=UTF-8''Workers-Singbox.json",
                                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
                            }
                        });
                    }
                    if (targetFmt === 'clash' || targetFmt === 'mihomo' || targetFmt === 'clash-meta' || targetFmt === 'clash-classic') {
                        const metaParam = url.searchParams.get('meta');
                        let isMeta = true;
                        if (targetFmt === 'mihomo' || targetFmt === 'clash-meta' || metaParam === '1' || metaParam === 'true') {
                            isMeta = true;
                        } else if (targetFmt === 'clash-classic' || metaParam === '0' || metaParam === 'false') {
                            isMeta = false;
                        } else {
                            const ua = (request.headers.get('User-Agent') || '').toLowerCase();
                            if (/flclash|mihomo|meta|verge|stash|party|clashmi|nikki|openclash|pandora|nya/.test(ua)) {
                                isMeta = true;
                            } else if (ua.includes('clash')) {
                                isMeta = false;
                            }
                        }
                        const yamlText = generateClashConfig(filteredNodes, isMeta);
                        return new Response(yamlText, {
                            headers: {
                                'Content-Type': 'text/yaml; charset=utf-8',
                                'Content-Disposition': "attachment; filename*=UTF-8''Workers-Clash.yaml",
                                'profile-update-interval': '24',
                                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
                            }
                        });
                    }

                    const linksText = filteredNodes.map(n => n.uri).join('\n');
                    const base64Content = btoa(unescape(encodeURIComponent(linksText)));
                    return new Response(base64Content, {
                        headers: {
                            'Content-Type': 'text/plain; charset=utf-8',
                            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                        },
                    });
                }
            }
            return new Response('Not Found', { status: 404 });
        } catch (err) {
            // 不向外暴露内部错误细节
            console.log('[worker error]', err && err.stack ? err.stack : err);
            return new Response('Internal Server Error', { status: 500 });
        }
    },
};

export default {
    async fetch(request, env, ctx) {
        return withSecurityHeaders(await workerApp.fetch(request, env, ctx));
    }
};

/**
 * 
 * @param {import("@cloudflare/workers-types").Request} request
 * @param {string} customProxyIP
 * @param {string} validSSPath
 */
async function handleVlsRequest(request, customProxyIP, validSSPath, config) {
    const wssPair = new WebSocketPair();
    const [clientSock, serverSock] = Object.values(wssPair);
    serverSock.accept({ allowHalfOpen: true });
    serverSock.binaryType = 'arraybuffer';
    let remoteConnWrapper = { socket: null };
    let cleanedUp = false;
    const cleanupRemote = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        const rs = remoteConnWrapper.socket;
        remoteConnWrapper.socket = null;
        closeSocketQuietly(rs);
    };
    serverSock.addEventListener('close', cleanupRemote);
    serverSock.addEventListener('error', cleanupRemote);
    let isDnsQuery = false;
    let isTrojan = false;
    let isTrojanUdp = false;
    const earlyData = request.headers.get('sec-websocket-protocol') || '';
    const readable = makeReadableStr(serverSock, earlyData);

    const url = new URL(request.url);
    const pathname = url.pathname;
    const isSSPath = validSSPath && pathname.toLowerCase().startsWith(validSSPath.toLowerCase());

    const activeConfig = config || {
        yourUUID,
        password,
        disablevless,
        disabless,
        disabletro,
        ssMethod,
        ssPsk
    };

    let ssInstance = null;
    if (!activeConfig.disabless && isSSPath) {
        const method = activeConfig.ssMethod || 'aes-256-gcm';
        const methodInfo = C_SS[method] || C_SS['aes-256-gcm'];
        let effectivePsk = '';
        if (methodInfo.b3) {
            effectivePsk = await deriveSS_Psk(activeConfig.ssPsk || activeConfig.yourUUID, methodInfo.k);
        } else {
            effectivePsk = activeConfig.ssPsk || activeConfig.yourUUID;
        }
        ssInstance = new SS_Engine({
            pw: activeConfig.ssPsk || activeConfig.yourUUID,
            psk: effectivePsk,
            method: method
        });
        await ssInstance.init();
    }

    const upQueue = mkQ(GRAIN_CFG.upPack);
    let headPending = null;
    remoteConnWrapper.flush = () => flushUpstream();
    let isWriting = false;

    async function flushUpstream() {
        if (isWriting || !remoteConnWrapper.socket) return;
        isWriting = true;
        try {
            while (!upQueue.empty && remoteConnWrapper.socket) {
                const [bundle] = upQueue.bundle();
                if (!bundle) break;
                if (remoteConnWrapper.replay) {
                    remoteConnWrapper.replay.push(bundle.slice());
                    remoteConnWrapper.replayBytes = (remoteConnWrapper.replayBytes || 0) + bundle.byteLength;
                    if (remoteConnWrapper.replayBytes > 65536) remoteConnWrapper.replay = null; // 过大则放弃补发
                }
                const writer = remoteConnWrapper.socket.writable.getWriter();
                try {
                    await writer.write(bundle);
                } finally {
                    writer.releaseLock();
                }
            }
        } catch (e) {
            // 直连阶段写失败且还能切反代时，不断开客户端，交给重试逻辑
            if (!remoteConnWrapper.switching) closeSocketQuietly(serverSock);
        } finally {
            isWriting = false;
            if (!upQueue.empty && remoteConnWrapper.socket) {
                flushUpstream();
            }
        }
    }

    readable.pipeTo(new WritableStream({
        async write(chunk) {
            if (isTrojanUdp) return await forwardTrojanUdpDns(chunk, serverSock);
            if (isDnsQuery) return await forwardataudp(chunk, serverSock, null, ssInstance);
            if (remoteConnWrapper.socket) {
                if (ssInstance) {
                    const { c: decryptedChunks, e: decryptError } = await ssInstance.decData(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
                    if (decryptError) {
                        closeSocketQuietly(serverSock);
                        return;
                    }
                    if (decryptedChunks && decryptedChunks.length > 0) {
                        for (const ck of decryptedChunks) {
                            upQueue.sow(ck);
                        }
                        await flushUpstream();
                    }
                    return;
                }
                upQueue.sow(chunk);
                await flushUpstream();
                return;
            }
            
            // 1. Shadowsocks 协议握手与数据转发
            if (ssInstance) {
                const { c: decryptedChunks, e: decryptError } = await ssInstance.decData(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
                if (decryptError) {
                    closeSocketQuietly(serverSock);
                    return;
                }
                if (!decryptedChunks || decryptedChunks.length === 0) return;

                for (const ck of decryptedChunks) {
                    if (remoteConnWrapper.socket) {
                        upQueue.sow(ck);
                        await flushUpstream();
                        continue;
                    }

                    const addrInfo = parseSSAddr(ck);
                    if (!addrInfo) {
                        closeSocketQuietly(serverSock);
                        return;
                    }

                    const { h: hostname, p: port, o: rawIndex, addressType } = addrInfo;


                    if (addressType === 2) { 
                        if (port === 53) isDnsQuery = true;
                        else throw new Error('UDP is not supported');
                    }

                    const rawData = ck.slice(rawIndex);
                    if (isDnsQuery) {
                        await forwardataudp(rawData, serverSock, null, ssInstance);
                        return;
                    }

                    await forwardataTCP(hostname, port, rawData, serverSock, null, remoteConnWrapper, customProxyIP, request, ssInstance);
                    if (remoteConnWrapper.socket && !upQueue.empty) await flushUpstream();
                }
                return;
            }

            // 首包缓冲：协议头被拆成多个 WebSocket 消息时先攒齐再解析
            if (headPending) {
                const cur = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                const merged = new Uint8Array(headPending.length + cur.length);
                merged.set(headPending); merged.set(cur, headPending.length);
                chunk = merged;
                headPending = null;
            }
            const isIncomplete = r => !!(r && r.hasError && /^(truncated|invalid s5 request data)/i.test(r.message || ''));
            let vlsResult = null, trojanResult = null;

            // 2. 尝试 VLESS 协议解析 (同步字节比对，0 异步开销)
            if (!activeConfig.disablevless) {
                vlsResult = parseVLsPacketHeader(chunk, activeConfig.yourUUID, yourUUIDBytes);
                if (!vlsResult.hasError) {
                    const { addressType, port, hostname, rawIndex, version, isUDP } = vlsResult;


                    if (isUDP) {
                        if (port === 53) isDnsQuery = true;
                        else throw new Error('UDP is not supported');
                    }
                    const respHeader = new Uint8Array([version[0], 0]);
                    const rawData = chunk.slice(rawIndex);
                    if (isDnsQuery) return forwardataudp(rawData, serverSock, respHeader);
                    await forwardataTCP(hostname, port, rawData, serverSock, respHeader, remoteConnWrapper, customProxyIP, request);
                    if (remoteConnWrapper.socket && !upQueue.empty) await flushUpstream();
                    return;
                }
            }

            // 3. 尝试 Trojan 协议解析 (复用预计算的 SHA-224 哈希)
            if (!activeConfig.disabletro) {
                const expectedHash = (activeConfig.yourUUID === cachedUUIDStr && cachedTrojanHash) ? cachedTrojanHash : null;
                trojanResult = await parsetroHeader(chunk, activeConfig.yourUUID, expectedHash);
                if (!trojanResult.hasError) {
                    isTrojan = true;
                    const { addressType, port, hostname, rawClientData, isUDP } = trojanResult;
                    if (isUDP) {
                        if (port === 53) {
                            isTrojanUdp = true;
                            if (rawClientData && rawClientData.byteLength > 0) {
                                await forwardTrojanUdpDns(rawClientData, serverSock);
                            }
                            return;
                        }
                        throw new Error('Trojan UDP is only supported for DNS port 53');
                    }
                    await forwardataTCP(hostname, port, rawClientData, serverSock, null, remoteConnWrapper, customProxyIP, request);
                    if (remoteConnWrapper.socket && !upQueue.empty) await flushUpstream();
                    return;
                }
            }

            // 已启用的协议判定“数据还不完整”且累计不足 2KB，则继续等待下一个消息
            if ((isIncomplete(vlsResult) || isIncomplete(trojanResult)) && chunk.byteLength < 2048) {
                headPending = (chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)).slice();
                return;
            }
            throw new Error('Protocol parse error');
        },
    })).catch((err) => {
        closeSocketQuietly(serverSock);
    }).finally(cleanupRemote);

    return new Response(null, { 
        status: 101, 
        webSocket: clientSock,
        headers: { 'Sec-WebSocket-Extensions': '' }
    });
}

async function parsetroHeader(buffer, passwordPlainText, precomputedHash = null) {
  if (!buffer || buffer.byteLength < 64) {
    return { hasError: true, message: "truncated header" };
  }
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (u8[56] !== 0x0d || u8[57] !== 0x0a) {
    return { hasError: true, message: "invalid header format" };
  }
  const sha224Password = precomputedHash || await sha224(passwordPlainText);
  const password = dec_ss.decode(u8.subarray(0, 56));
  if (password !== sha224Password) {
    return { hasError: true, message: "invalid password" };
  }

  const socks5Offset = 58;
  const socks5Len = u8.byteLength - socks5Offset;
  if (socks5Len < 8) {
    return { hasError: true, message: "invalid S5 request data" };
  }

  const cmd = u8[socks5Offset];
  if (cmd !== 1 && cmd !== 3) {
    return { hasError: true, message: "unsupported command" };
  }
  const isUDP = cmd === 3;

  const atype = u8[socks5Offset + 1];
  let addressLength = 0;
  let addressIndex = socks5Offset + 2;
  let address = "";
  switch (atype) {
    case 1: // IPv4
      addressLength = 4;
      if (addressIndex + addressLength + 4 > u8.byteLength) return { hasError: true, message: "truncated ipv4 header" };
      address = u8.subarray(addressIndex, addressIndex + 4).join(".");
      break;
    case 3: // Domain
      addressLength = u8[addressIndex];
      addressIndex += 1;
      if (addressIndex + addressLength + 4 > u8.byteLength) return { hasError: true, message: "truncated domain header" };
      address = dec_ss.decode(u8.subarray(addressIndex, addressIndex + addressLength));
      break;
    case 4: { // IPv6
      addressLength = 16;
      if (addressIndex + addressLength + 4 > u8.byteLength) return { hasError: true, message: "truncated ipv6 header" };
      const dataView = new DataView(u8.buffer, u8.byteOffset + addressIndex, 16);
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      address = ipv6.join(":");
      break;
    }
    default:
      return { hasError: true, message: `invalid addressType is ${atype}` };
  }

  if (!address) {
    return { hasError: true, message: `address is empty, addressType is ${atype}` };
  }

  const portIndex = addressIndex + addressLength;
  const portRemote = (u8[portIndex] << 8) | u8[portIndex + 1];
  const rawStart = portIndex + 4;
  const rawClientData = buffer instanceof Uint8Array ? buffer.subarray(rawStart) : buffer.slice(rawStart);

  return {
    hasError: false,
    addressType: atype,
    port: portRemote,
    hostname: address,
    isUDP,
    rawClientData
  };
}

async function connect2Socks5(proxyConfig, targetHost, targetPort, initialData) {
    const { host, port, username, password } = proxyConfig;
    let socket;
    try {
        socket = connect({ hostname: host, port: port });
        await withTimeout(socket.opened, 8000, `TCP connect to S5 ${host}:${port} timeout`);
    } catch (e) {
        closeSocketQuietly(socket);
        throw new Error(`[socks5 proxy] ${e && e.message ? e.message : e}`);
    }
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // 带缓冲的精确读取：解决 TCP 拆包/粘包
    let buf = new Uint8Array(0);
    const readExact = async (n, what) => {
        while (buf.length < n) {
            const { done, value } = await withTimeout(reader.read(), 10000, `S5 ${what} timeout`);
            if (done) throw new Error(`S5 connection closed during ${what}`);
            const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
            const nb = new Uint8Array(buf.length + chunk.length);
            nb.set(buf); nb.set(chunk, buf.length);
            buf = nb;
        }
        const out = buf.slice(0, n);
        buf = buf.subarray(n);
        return out;
    };

    try {
        const useAuth = !!(username || password);
        await writer.write(useAuth ? new Uint8Array([0x05, 0x02, 0x00, 0x02]) : new Uint8Array([0x05, 0x01, 0x00]));
        const mr = await readExact(2, 'method selection');
        if (mr[0] !== 0x05) throw new Error('S5 invalid version in method reply');
        const method = mr[1];
        if (method === 0x02) {
            if (!useAuth) throw new Error('S5 requires authentication');
            const u = new TextEncoder().encode(username || '');
            const pw = new TextEncoder().encode(password || '');
            if (u.length > 255 || pw.length > 255) throw new Error('S5 username/password too long');
            const pkt = new Uint8Array(3 + u.length + pw.length);
            pkt[0] = 0x01; pkt[1] = u.length; pkt.set(u, 2);
            pkt[2 + u.length] = pw.length; pkt.set(pw, 3 + u.length);
            await writer.write(pkt);
            const ar = await readExact(2, 'authentication');
            if (ar[1] !== 0x00) throw new Error('S5 authentication failed');
        } else if (method === 0xff) {
            throw new Error('S5 no acceptable auth method');
        } else if (method !== 0x00) {
            throw new Error(`S5 unsupported auth method: ${method}`);
        }

        // 构造 CONNECT：自动识别 IPv4 / IPv6 / 域名
        const h = String(targetHost).replace(/^\[|\]$/g, '');
        let addr;
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
            addr = new Uint8Array([0x01, ...h.split('.').map(Number)]);
        } else if (h.includes(':')) {
            const parts = h.split('::');
            const head = parts[0] ? parts[0].split(':') : [];
            const tail = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
            const groups = parts.length > 1 ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail] : head;
            addr = new Uint8Array(17); addr[0] = 0x04;
            groups.forEach((g, i) => { const v = parseInt(g || '0', 16); addr[1 + i * 2] = v >> 8; addr[2 + i * 2] = v & 0xff; });
        } else {
            const hb = new TextEncoder().encode(h);
            if (hb.length > 255) throw new Error('S5 hostname too long');
            addr = new Uint8Array(2 + hb.length); addr[0] = 0x03; addr[1] = hb.length; addr.set(hb, 2);
        }
        const req = new Uint8Array(3 + addr.length + 2);
        req.set([0x05, 0x01, 0x00]); req.set(addr, 3);
        new DataView(req.buffer).setUint16(3 + addr.length, targetPort, false);
        await writer.write(req);

        // 回复：VER REP RSV ATYP BND.ADDR BND.PORT，长度按 ATYP 计算
        const rh = await readExact(4, 'connect reply');
        if (rh[1] !== 0x00) {
            const reasons = { 1: 'general failure', 2: 'not allowed by ruleset', 3: 'network unreachable', 4: 'host unreachable', 5: 'connection refused', 6: 'TTL expired', 7: 'command not supported', 8: 'address type not supported' };
            throw new Error(`S5 connect failed: ${reasons[rh[1]] || rh[1]}`);
        }
        let addrLen;
        if (rh[3] === 0x01) addrLen = 4;
        else if (rh[3] === 0x04) addrLen = 16;
        else if (rh[3] === 0x03) addrLen = (await readExact(1, 'connect reply'))[0];
        else throw new Error(`S5 bad reply ATYP: ${rh[3]}`);
        await readExact(addrLen + 2, 'connect reply');

        if (initialData && initialData.byteLength > 0) await writer.write(initialData);
        writer.releaseLock();

        // 回复后粘带的目标数据不能丢
        if (buf.length > 0) {
            const extra = buf.slice();
            const readable = new ReadableStream({
                start(c) { c.enqueue(extra); },
                pull(c) {
                    return reader.read().then(({ done, value }) => {
                        if (done) c.close();
                        else c.enqueue(value instanceof Uint8Array ? value : new Uint8Array(value));
                    }, err => c.error(err));
                },
                cancel() { reader.cancel().catch(() => {}); closeSocketQuietly(socket); }
            });
            return { readable, writable: socket.writable, close: () => closeSocketQuietly(socket), closed: socket.closed };
        }
        reader.releaseLock();
        return socket;
    } catch (error) {
        try { writer.releaseLock(); } catch (e) {}
        try { reader.releaseLock(); } catch (e) {}
        closeSocketQuietly(socket);
        throw error;
    }
}

// 解析 CONNECT 响应头（通用于原生 socket 与 Mini TLS）
async function readConnectResponse(readFn) {
    let buf = new Uint8Array(0), end = -1;
    while (end === -1 && buf.length < 8192) {
        const chunk = await withTimeout(readFn(), 10000, 'proxy CONNECT response timeout');
        if (!chunk) throw new Error('Connection closed before receiving HTTP response');
        if (!chunk.byteLength) continue;
        const nb = new Uint8Array(buf.length + chunk.byteLength);
        nb.set(buf); nb.set(chunk, buf.length);
        const start = Math.max(0, buf.length - 3);
        buf = nb;
        for (let i = start; i < buf.length - 3; i++) {
            if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) { end = i + 4; break; }
        }
    }
    if (end === -1) throw new Error('Invalid HTTP response');
    const statusLine = dec_ss.decode(buf.subarray(0, end)).split('\r\n')[0];
    const m = statusLine.match(/HTTP\/\d(?:\.\d)?\s+(\d+)/);
    if (!m) throw new Error(`Invalid response: ${statusLine}`);
    const code = parseInt(m[1], 10);
    if (code === 407) throw new Error('Proxy authentication failed (407)');
    if (code < 200 || code >= 300) throw new Error(`Connection failed: ${statusLine}`);
    return buf.slice(end);
}

function buildConnectRequest(targetHost, targetPort, username, password) {
    const authority = targetHost.includes(':') && !targetHost.startsWith('[') ? `[${targetHost}]:${targetPort}` : `${targetHost}:${targetPort}`;
    let req = `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n`;
    if (username || password) {
        const authBytes = enc_ss.encode(`${username || ''}:${password || ''}`);
        let binary = '';
        for (let i = 0; i < authBytes.length; i++) binary += String.fromCharCode(authBytes[i]);
        req += `Proxy-Authorization: Basic ${btoa(binary)}\r\n`;
    }
    req += `User-Agent: Mozilla/5.0\r\nProxy-Connection: keep-alive\r\nConnection: keep-alive\r\n\r\n`;
    return enc_ss.encode(req);
}

const isIpLiteral = h => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || String(h).includes(':');

// 路径一：原生 TLS / 明文 TCP
async function connect2HttpNative(proxyConfig, targetHost, targetPort, initialData) {
    const { type, host, port, username, password, sni } = proxyConfig;
    const isHttps = type === 'https';
    let socket;
    try {
        if (isHttps && sni && sni !== host) {
            const plain = connect({ hostname: host, port }, { secureTransport: 'starttls' });
            await withTimeout(plain.opened, 8000, `TCP connect to ${host}:${port} timeout`);
            socket = plain.startTls({ expectedServerHostname: sni });
        } else {
            socket = isHttps ? connect({ hostname: host, port }, { secureTransport: 'on' }) : connect({ hostname: host, port });
        }
        await withTimeout(socket.opened, 8000, `connect/TLS to ${host}:${port} timeout`);
    } catch (e) {
        closeSocketQuietly(socket);
        throw e;
    }
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    try {
        await writer.write(buildConnectRequest(targetHost, targetPort, username, password));
        const extra = await readConnectResponse(async () => {
            const { done, value } = await reader.read();
            return done ? null : (value instanceof Uint8Array ? value : new Uint8Array(value));
        });
        if (initialData && initialData.byteLength > 0) await writer.write(initialData);
        writer.releaseLock();
        if (extra.byteLength > 0) {
            const readable = new ReadableStream({
                start(c) { c.enqueue(extra); },
                pull(c) {
                    return reader.read().then(({ done, value }) => {
                        if (done) c.close();
                        else c.enqueue(value instanceof Uint8Array ? value : new Uint8Array(value));
                    }, err => c.error(err));
                },
                cancel() { reader.cancel().catch(() => {}); closeSocketQuietly(socket); }
            });
            return { readable, writable: socket.writable, close: () => closeSocketQuietly(socket), closed: socket.closed };
        }
        reader.releaseLock();
        return socket;
    } catch (error) {
        try { writer.releaseLock(); } catch (e) {}
        try { reader.releaseLock(); } catch (e) {}
        closeSocketQuietly(socket);
        throw error;
    }
}

// 路径二：原始 TCP + Worker 内 Mini TLS（跳过证书校验，适配 IP / 自签 / 证书不匹配）
async function connect2HttpsMiniTls(proxyConfig, targetHost, targetPort, initialData) {
    const { host, port, username, password, sni } = proxyConfig;
    const raw = connect({ hostname: host, port });
    let tls;
    try {
        await withTimeout(raw.opened, 8000, `TCP connect to ${host}:${port} timeout`);
        // timeout:0 关闭库内读超时，避免空闲隧道 30 秒后被误杀；握手超时由外层控制
        const serverName = sni || (isIpLiteral(host) ? '' : host);
        tls = new MiniTlsClient(raw, { serverName, timeout: 0 });
        await withTimeout(tls.handshake(), 10000, `Mini TLS handshake with ${host}:${port} timeout`);
        await tls.write(buildConnectRequest(targetHost, targetPort, username, password));
        const extra = await readConnectResponse(() => tls.read());
        const MAX_REC = 16000;
        const tlsWrite = async d => {
            const u8 = d instanceof Uint8Array ? d : new Uint8Array(d);
            for (let o = 0; o < u8.byteLength; o += MAX_REC) await tls.write(u8.subarray(o, o + MAX_REC));
        };
        if (initialData && initialData.byteLength > 0) await tlsWrite(initialData);
        let closedFlag = false;
        const doClose = () => { if (closedFlag) return; closedFlag = true; try { tls.close(); } catch (e) {} };
        const readable = new ReadableStream({
            start(c) { if (extra.byteLength) c.enqueue(extra); },
            async pull(c) {
                try {
                    for (;;) {
                        const d = await tls.read();
                        if (!d) { c.close(); doClose(); return; }
                        if (d.byteLength) { c.enqueue(d); return; }
                    }
                } catch (e) { c.error(e); doClose(); }
            },
            cancel() { doClose(); }
        });
        const writable = new WritableStream({
            write: chunk => tlsWrite(chunk),
            close() { doClose(); },
            abort() { doClose(); }
        });
        return { readable, writable, close: doClose, closed: raw.closed };
    } catch (e) {
        try { tls ? tls.close() : raw.close(); } catch (_) {}
        throw e;
    }
}

async function connect2Http(proxyConfig, targetHost, targetPort, initialData) {
    const { type, host, port, sni, insecure } = proxyConfig;
    if (type !== 'https') {
        return connect2HttpNative(proxyConfig, targetHost, targetPort, initialData);
    }
    // 显式 insecure，或纯 IP 且没给 sni：原生 TLS 必然校验失败，直接走 Mini TLS
    if (insecure || (isIpLiteral(host) && !sni)) {
        try {
            return await connect2HttpsMiniTls(proxyConfig, targetHost, targetPort, initialData);
        } catch (e) {
            throw new Error(`[https proxy / mini-tls] ${host}:${port} ${e && e.message ? e.message : e}`);
        }
    }
    // 正常证书：先原生快路径，TLS 层失败再自动回退 Mini TLS（407 / 非 2xx 不回退）
    try {
        return await connect2HttpNative(proxyConfig, targetHost, targetPort, initialData);
    } catch (e1) {
        const msg = String(e1 && e1.message || e1);
        if (/407|Connection failed: HTTP/.test(msg)) throw new Error(`[https proxy] ${msg}`);
        try {
            return await connect2HttpsMiniTls(proxyConfig, targetHost, targetPort, initialData);
        } catch (e2) {
            throw new Error(`[https proxy] native: ${msg}; mini-tls: ${e2 && e2.message ? e2.message : e2}`);
        }
    }
}

function withTimeout(promise, ms, msg) {
    let t;
    return Promise.race([
        promise,
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg || 'timeout')), ms); })
    ]).finally(() => clearTimeout(t));
}

// ------------------------- DoH DNS 解析 (含 5 分钟内存缓存) -------------------------
const dnsMemoryCache = new Map();
const DNS_CACHE_TTL_MS = 300000;

async function resolveDnsA(host) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
    const key = String(host).toLowerCase();
    const now = Date.now();
    const cached = dnsMemoryCache.get(key);
    if (cached && now < cached.exp) return cached.ip;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
        const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(key)}&type=A`, {
            headers: { Accept: 'application/dns-json' },
            signal: controller.signal
        });
        const json = await res.json();
        const ans = json.Answer?.find(a => a.type === 1);
        const ip = ans?.data || null;
        if (ip) {
            if (dnsMemoryCache.size >= 500) {
                dnsMemoryCache.delete(dnsMemoryCache.keys().next().value);
            }
            dnsMemoryCache.set(key, { ip, exp: now + DNS_CACHE_TTL_MS });
        }
        return ip;
    } catch (e) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// 解析域名全部 A 记录（反代多 IP 轮询用），带 5 分钟缓存
const dnsAllCache = new Map();
async function resolveDnsAll(host) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || String(host).includes(':')) return [host];
    const key = String(host).toLowerCase();
    const now = Date.now();
    const cached = dnsAllCache.get(key);
    if (cached && now < cached.exp) return cached.ips;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
        const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(key)}&type=A`, {
            headers: { Accept: 'application/dns-json' },
            signal: controller.signal
        });
        const json = await res.json();
        const ips = (json.Answer || []).filter(a => a.type === 1 && a.data).map(a => a.data);
        if (ips.length) {
            if (dnsAllCache.size >= 200) dnsAllCache.delete(dnsAllCache.keys().next().value);
            dnsAllCache.set(key, { ips, exp: now + DNS_CACHE_TTL_MS });
            return ips;
        }
    } catch (e) {
    } finally {
        clearTimeout(timer);
    }
    return [host]; // 解析失败交给 connect 自行解析
}

// 直连失败缓存：目标在 5 分钟内直接走反代（如 Cloudflare 站点）
const directFailCache = new Map();
const DIRECT_FAIL_TTL_MS = 5 * 60 * 1000;
function markDirectFail(host) {
    const k = String(host).toLowerCase();
    if (directFailCache.size >= 2000) directFailCache.delete(directFailCache.keys().next().value);
    directFailCache.set(k, Date.now() + DIRECT_FAIL_TTL_MS);
}
function isDirectFailCached(host) {
    const k = String(host).toLowerCase();
    const exp = directFailCache.get(k);
    if (!exp) return false;
    if (exp > Date.now()) return true;
    directFailCache.delete(k);
    return false;
}

// ------------------------- SoftEther (MS-SSTP) 落地代理 -------------------------
const sstpCat = (...a) => {
    const r = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
    a.reduce((o, x) => (r.set(x, o), o + x.length), 0);
    return r;
};
const sstpU16 = (b, o) => (b[o] << 8) | b[o + 1];
const sstpU32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const sstpRng = n => crypto.getRandomValues(new Uint8Array(n));
const sstpRng16 = () => sstpU16(sstpRng(2), 0);
const sstpRng32 = () => sstpU32(sstpRng(4), 0);
const sstpIpB = ip => new Uint8Array(ip.split('.').map(Number));
const sstpCksum = (d, o, n) => {
    let s = 0;
    for (let i = o; i < o + n - 1; i += 2) s += sstpU16(d, i);
    if (n & 1) s += d[o + n - 1] << 8;
    while (s >> 16) s = (s & 0xFFFF) + (s >> 16);
    return (~s) & 0xFFFF;
};

function createSstpEngine(proxyConfig) {
    const E = new Uint8Array(0);
    const user = proxyConfig.username || 'vpn';
    const pass = proxyConfig.password || 'vpn';
    const papCredUser = new TextEncoder().encode(user);
    const papCredPass = new TextEncoder().encode(pass);
    const dec = new TextDecoder();
    const enc = s => new TextEncoder().encode(s);
    
    let buf = E, pppId = 1, sock = null, rd = null, wr = null, host = proxyConfig.host, rb = new ArrayBuffer(65536);
    
    const readBytes = async n => {
        if (buf.length >= n) {
            const r = buf.subarray(0, n);
            buf = buf.subarray(n);
            return r;
        }
        const saved = buf.length > 0 ? new Uint8Array(buf) : null;
        const need = n - buf.length;
        const { value, done } = await rd.readAtLeast(need, new Uint8Array(rb, 0, 65536));
        if (done) throw new Error('SSTP connection closed prematurely');
        rb = value.buffer;
        if (saved) {
            const t = sstpCat(saved, value);
            buf = t.subarray(n);
            return t.subarray(0, n);
        }
        buf = value.subarray(n);
        return value.subarray(0, n);
    };

    const readLine = async () => {
        for (;;) {
            const i = buf.indexOf(10);
            if (i >= 0) {
                let l = dec.decode(buf.subarray(0, i));
                buf = buf.subarray(i + 1);
                return l.replace(/\r$/, '');
            }
            const saved = buf.length > 0 ? new Uint8Array(buf) : null;
            const { value, done } = await rd.readAtLeast(1, new Uint8Array(rb, 0, 65536));
            if (done) throw new Error('SSTP connection closed');
            rb = value.buffer;
            buf = saved ? sstpCat(saved, value) : value;
        }
    };

    const readPkt = async (ms = 10000) => {
        let t;
        const to = new Promise((_, r) => { t = setTimeout(() => r(new Error('Timeout')), ms); });
        try {
            const h = await Promise.race([readBytes(4), to]);
            clearTimeout(t);
            const len = sstpU16(h, 2) & 0xFFF;
            return { ctrl: (h[1] & 1) !== 0, body: len > 4 ? await readBytes(len - 4) : E };
        } catch (e) {
            clearTimeout(t);
            throw e;
        }
    };

    const sstpData = f => {
        const n = 6 + f.length, p = new Uint8Array(n);
        p.set([0x10, 0, ((n >> 8) & 0xF) | 0x80, n & 0xFF, 0xFF, 0x03]);
        p.set(f, 6);
        return p;
    };

    const sstpCtrl = (mt, attrs = []) => {
        const al = attrs.reduce((s, a) => s + 4 + a.data.length, 0);
        const p = new Uint8Array(8 + al), v = new DataView(p.buffer);
        p[0] = 0x10; p[1] = 0x01;
        v.setUint16(2, (8 + al) | 0x8000);
        v.setUint16(4, mt);
        v.setUint16(6, attrs.length);
        attrs.reduce((o, a) => (p[o + 1] = a.id, v.setUint16(o + 2, 4 + a.data.length), p.set(a.data, o + 4), o + 4 + a.data.length), 8);
        return p;
    };

    const ppp = (proto, code, id, opts = []) => {
        const ol = opts.reduce((s, o) => s + 2 + o.data.length, 0);
        const f = new Uint8Array(6 + ol), v = new DataView(f.buffer);
        v.setUint16(0, proto);
        f[2] = code; f[3] = id;
        v.setUint16(4, 4 + ol);
        opts.reduce((o, x) => (f[o] = x.type, f[o + 1] = 2 + x.data.length, f.set(x.data, o + 2), o + 2 + x.data.length), 6);
        return f;
    };

    const pap = id => {
        const ul = papCredUser.length, pl = papCredPass.length;
        const tl = 6 + ul + pl, f = new Uint8Array(2 + tl), v = new DataView(f.buffer);
        v.setUint16(0, 0xc023);
        f[2] = 1; f[3] = id;
        v.setUint16(4, tl);
        f[6] = ul; f.set(papCredUser, 7);
        f[7 + ul] = pl; f.set(papCredPass, 8 + ul);
        return f;
    };

    const parsePPP = d => {
        let o = d.length >= 2 && d[0] === 0xFF && d[1] === 0x03 ? 2 : 0;
        if (d.length - o < 4) return null;
        const p = sstpU16(d, o);
        return p === 0x0021 ? { protocol: p, ip: d.subarray(o + 2) } :
               d.length - o >= 6 ? { protocol: p, code: d[o + 2], id: d[o + 3], payload: d.subarray(o + 6), raw: d.subarray(o) } : null;
    };

    const parseOpts = d => {
        const r = [];
        for (let i = 0; i + 2 <= d.length;) {
            const t = d[i], l = d[i + 1];
            if (l < 2 || i + l > d.length) break;
            r.push({ type: t, data: d.subarray(i + 2, i + l) });
            i += l;
        }
        return r;
    };

    const connect_ = async (h, p) => {
        sock = connect({ hostname: h, port: p }, { secureTransport: 'on' });
        await sock.opened;
        rd = sock.readable.getReader({ mode: 'byob' });
        wr = sock.writable.getWriter();
        host = h;
    };

    const establish = async () => {
        const http = enc(`SSTP_DUPLEX_POST /sra_{BA195980-CD49-458b-9E23-C84EE0ADCD75}/ HTTP/1.1\r\nHost: ${host}\r\nContent-Length: 18446744073709551615\r\nSSTPCORRELATIONID: {${crypto.randomUUID()}}\r\n\r\n`);
        const pa = new Uint8Array(2);
        new DataView(pa.buffer).setUint16(0, 1);
        const mru = new Uint8Array(2);
        new DataView(mru.buffer).setUint16(0, 1500);
        await wr.write(sstpCat(http, sstpCtrl(0x0001, [{ id: 1, data: pa }]), sstpData(ppp(0xc021, 1, pppId++, [{ type: 1, data: mru }]))));
        const st = await readLine();
        while ((await readLine()) !== '') {}
        if (!st.includes('200')) throw new Error('SSTP handshake failed: ' + st);
        
        let sa = false, ld = false, auth = false, done = false, myIp = null;
        for (let r = 0; r < 25 && !done; r++) {
            const pk = await readPkt();
            if (pk.ctrl) {
                if (!sa && pk.body.length >= 2 && sstpU16(pk.body, 0) === 2) sa = true;
                continue;
            }
            const pp = parsePPP(pk.body);
            if (!pp) continue;
            if (pp.protocol === 0xc021) {
                if (pp.code === 1) {
                    const a = new Uint8Array(pp.raw);
                    a[2] = 2;
                    await wr.write(ld && !auth ? sstpCat(sstpData(a), sstpData(pap(pppId++))) : sstpData(a));
                    if (ld) auth = true;
                } else if (pp.code === 2) {
                    ld = true;
                    if (!auth) {
                        await wr.write(sstpData(pap(pppId++)));
                        auth = true;
                    }
                }
            } else if (pp.protocol === 0xc023 && pp.code === 2) {
                await wr.write(sstpData(ppp(0x8021, 1, pppId++, [{ type: 3, data: new Uint8Array(4) }])));
            } else if (pp.protocol === 0x8021) {
                if (pp.code === 1) {
                    const a = new Uint8Array(pp.raw);
                    a[2] = 2;
                    await wr.write(sstpData(a));
                } else if (pp.code === 3) {
                    const o = parseOpts(pp.payload).find(x => x.type === 3);
                    if (o) {
                        myIp = [...o.data].join('.');
                        await wr.write(sstpData(ppp(0x8021, 1, pppId++, [{ type: 3, data: o.data }])));
                    }
                } else if (pp.code === 2) {
                    const o = parseOpts(pp.payload).find(x => x.type === 3);
                    if (o) myIp = [...o.data].join('.');
                    done = true;
                }
            }
        }
        if (!myIp) throw new Error('SSTP failed to acquire virtual IP');
        return myIp;
    };

    const close = () => {
        [rd, wr, sock].forEach(x => {
            try { x?.cancel?.() ?? x?.close?.(); } catch {}
        });
    };

    return { connect: connect_, establish, readPkt, parsePPP, get buf() { return buf; }, get wr() { return wr; }, close };
}

function sstpCreateTcp(sstp, srcIp, dstIp, dstPort) {
    const srcPort = 10000 + (sstpRng16() % 50000);
    const srcB = sstpIpB(srcIp);
    const dstB = sstpIpB(dstIp);
    let seq = sstpRng32(), ack = 0;
    const ipTpl = new Uint8Array(20);
    ipTpl.set([0x45, 0, 0, 0, 0, 0, 0x40, 0, 64, 6]);
    ipTpl.set(srcB, 12);
    ipTpl.set(dstB, 16);
    const pseudo = new Uint8Array(1432);
    pseudo.set(srcB);
    pseudo.set(dstB, 4);
    pseudo[9] = 6;

    const frame = (flags, data = new Uint8Array(0)) => {
        const pl = data.length, tl = 20 + pl, il = 20 + tl, st = 8 + il;
        const f = new Uint8Array(st), v = new DataView(f.buffer);
        f.set([0x10, 0, ((st >> 8) & 0xF) | 0x80, st & 0xFF, 0xFF, 0x03, 0, 0x21]);
        f.set(ipTpl, 8);
        v.setUint16(10, il);
        v.setUint16(12, sstpRng16());
        v.setUint16(18, sstpCksum(f, 8, 20));
        v.setUint16(28, srcPort);
        v.setUint16(30, dstPort);
        v.setUint32(32, seq);
        v.setUint32(36, ack);
        f[40] = 0x50;
        f[41] = flags;
        v.setUint16(42, 65535);
        if (pl) f.set(data, 48);
        pseudo[10] = tl >> 8;
        pseudo[11] = tl & 0xFF;
        pseudo.set(f.subarray(28, 28 + tl), 12);
        v.setUint16(44, sstpCksum(pseudo, 0, 12 + tl));
        return f;
    };

    const match = ip => {
        if (ip.length < 40 || ip[9] !== 6) return null;
        const ihl = (ip[0] & 0xF) * 4;
        if (sstpU16(ip, ihl) !== dstPort || sstpU16(ip, ihl + 2) !== srcPort) return null;
        return { flags: ip[ihl + 13], seq: sstpU32(ip, ihl + 4), off: ihl + ((ip[ihl + 12] >> 4) & 0xF) * 4 };
    };

    const handshake = async () => {
        await sstp.wr.write(frame(0x02));
        seq = (seq + 1) >>> 0;
        for (let i = 0; i < 30; i++) {
            const pk = await sstp.readPkt();
            if (pk.ctrl) continue;
            const pp = sstp.parsePPP(pk.body);
            if (!pp || pp.protocol !== 0x0021) continue;
            const m = match(pp.ip);
            if (!m || (m.flags & 0x12) !== 0x12) continue;
            ack = (m.seq + 1) >>> 0;
            sstp.wr.write(frame(0x10)).catch(() => {});
            return true;
        }
        throw new Error('SSTP TCP handshake timeout');
    };

    return { frame, match, handshake, get seq() { return seq; }, set seq(v) { seq = v; }, get ack() { return ack; }, set ack(v) { ack = v; } };
}

async function connect2Sstp(proxyConfig, targetHost, targetPort, initialData) {
    const { host, port } = proxyConfig;
    const sstp = createSstpEngine(proxyConfig);
    let isClosed = false;
    let closedResolve;
    const closedPromise = new Promise(resolve => { closedResolve = resolve; });

    const closeAll = () => {
        if (isClosed) return;
        isClosed = true;
        try { sstp.close(); } catch {}
        closedResolve();
    };

    try {
        await sstp.connect(host, port || 443);
        const targetIpPromise = resolveDnsA(targetHost);
        const [myIp, targetIp] = await Promise.all([sstp.establish(), targetIpPromise]);
        if (!targetIp) throw new Error(`SSTP DNS resolution failed for: ${targetHost}`);

        const tcp = sstpCreateTcp(sstp, myIp, targetIp, targetPort);
        await tcp.handshake();

        let ctrl = null;
        const readable = new ReadableStream({
            start(c) { ctrl = c; },
            cancel() { closeAll(); }
        });

        (async () => {
            try {
                let pend = [], pLen = 0;
                const flush = () => {
                    if (!pLen) return;
                    ctrl.enqueue(pend.length === 1 ? pend[0] : sstpCat(...pend));
                    pend = [];
                    pLen = 0;
                    sstp.wr.write(tcp.frame(0x10)).catch(() => {});
                };
                for (;;) {
                    const pk = await sstp.readPkt(60000);
                    if (pk.ctrl) continue;
                    const pp = sstp.parsePPP(pk.body);
                    if (!pp || pp.protocol !== 0x0021) continue;
                    const m = tcp.match(pp.ip);
                    if (!m) continue;
                    if (m.off < pp.ip.length) {
                        const d = pp.ip.subarray(m.off);
                        if (d.length) {
                            tcp.ack = (m.seq + d.length) >>> 0;
                            pend.push(new Uint8Array(d));
                            pLen += d.length;
                        }
                    }
                    if (m.flags & 0x01) {
                        flush();
                        tcp.ack = (tcp.ack + 1) >>> 0;
                        sstp.wr.write(tcp.frame(0x11)).catch(() => {});
                        ctrl.close();
                        closeAll();
                        return;
                    }
                    if (sstp.buf.length < 4 || pLen >= 32768) flush();
                }
            } catch (err) {
                try { ctrl.close(); } catch {}
                closeAll();
            }
        })();

        const MSS = 1400;
        const writable = new WritableStream({
            async write(chunk) {
                const d = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                if (d.length <= MSS) {
                    await sstp.wr.write(tcp.frame(0x18, d));
                    tcp.seq = (tcp.seq + d.length) >>> 0;
                    return;
                }
                const frames = [];
                for (let o = 0; o < d.length; o += MSS) {
                    const seg = d.subarray(o, Math.min(o + MSS, d.length));
                    frames.push(tcp.frame(0x18, seg));
                    tcp.seq = (tcp.seq + seg.length) >>> 0;
                }
                await sstp.wr.write(sstpCat(...frames));
            },
            close() {
                sstp.wr.write(tcp.frame(0x11)).catch(() => {});
                closeAll();
            },
            abort() {
                closeAll();
            }
        });

        if (initialData && initialData.byteLength > 0) {
            const writer = writable.getWriter();
            await writer.write(initialData);
            writer.releaseLock();
        }

        return {
            readable,
            writable,
            close: closeAll,
            closed: closedPromise
        };
    } catch (err) {
        closeAll();
        throw err;
    }
}

// ------------------------- TURN (RFC 5766 / RFC 6062) 落地代理 -------------------------
const TURN_MAGIC = new Uint8Array([0x21, 0x12, 0xA4, 0x42]);
const TURN_MT = { AQ: 0x003, AO: 0x103, AE: 0x113, PQ: 0x008, PO: 0x108, CQ: 0x00A, CO: 0x10A, BQ: 0x00B, BO: 0x10B };
const TURN_AT = { USER: 0x006, MI: 0x008, ERR: 0x009, PEER: 0x012, REALM: 0x014, NONCE: 0x015, TRANSPORT: 0x019, CONNID: 0x02A };

const turnCat = (...a) => {
    const r = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
    a.reduce((o, x) => (r.set(x, o), o + x.length), 0);
    return r;
};

const turnStunAttr = (t, v) => {
    const b = new Uint8Array(4 + v.length + (4 - v.length % 4) % 4);
    const d = new DataView(b.buffer);
    d.setUint16(0, t);
    d.setUint16(2, v.length);
    b.set(v, 4);
    return b;
};

const turnStunMsg = (t, tid, a) => {
    const bd = turnCat(...a);
    const h = new Uint8Array(20);
    const d = new DataView(h.buffer);
    d.setUint16(0, t);
    d.setUint16(2, bd.length);
    h.set(TURN_MAGIC, 4);
    h.set(tid, 8);
    return turnCat(h, bd);
};

const turnXorPeer = (ip, port) => {
    const b = new Uint8Array(8);
    b[1] = 1;
    new DataView(b.buffer).setUint16(2, port ^ 0x2112);
    ip.split('.').forEach((v, i) => b[4 + i] = +v ^ TURN_MAGIC[i]);
    return b;
};

const turnParseStun = d => {
    if (d.length < 20 || TURN_MAGIC.some((v, i) => d[4 + i] !== v)) return null;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const ml = dv.getUint16(2);
    const attrs = {};
    for (let o = 20; o + 4 <= 20 + ml;) {
        const t = dv.getUint16(o);
        const l = dv.getUint16(o + 2);
        if (o + 4 + l > d.length) break;
        attrs[t] = d.slice(o + 4, o + 4 + l);
        o += 4 + l + (4 - l % 4) % 4;
    }
    return { type: dv.getUint16(0), attrs };
};

const turnParseErr = d => (d?.length >= 4 ? (d[2] & 7) * 100 + d[3] : 0);

const turnAddIntegrity = async (m, key) => {
    const c = new Uint8Array(m);
    const d = new DataView(c.buffer);
    d.setUint16(2, d.getUint16(2) + 24);
    const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    return turnCat(c, turnStunAttr(TURN_AT.MI, new Uint8Array(await crypto.subtle.sign('HMAC', k, c))));
};

const turnReadStun = async (rd, buf) => {
    let b = buf ?? new Uint8Array(0);
    const pull = async () => {
        const { done, value } = await rd.read();
        if (done) throw new Error('TURN stream closed');
        b = turnCat(b, new Uint8Array(value));
    };
    try {
        while (b.length < 20) await pull();
        const n = 20 + ((b[2] << 8) | b[3]);
        while (b.length < n) await pull();
        return [turnParseStun(b.subarray(0, n)), b.length > n ? b.subarray(n) : null];
    } catch {
        return [null, null];
    }
};

const turnMd5 = async s => new Uint8Array(await crypto.subtle.digest('MD5', new TextEncoder().encode(s)));

async function connect2Turn(proxyConfig, targetHost, targetPort, initialData) {
    const { host, port, username: user, password: pass } = proxyConfig;
    const targetIp = await resolveDnsA(targetHost);
    if (!targetIp) throw new Error(`TURN DNS resolution failed for: ${targetHost}`);

    let ctrl = null, data = null;
    let isClosed = false;
    let closedResolve;
    const closedPromise = new Promise(resolve => { closedResolve = resolve; });

    const closeAll = () => {
        if (isClosed) return;
        isClosed = true;
        try { ctrl?.close(); } catch {}
        try { data?.close(); } catch {}
        closedResolve();
    };

    try {
        ctrl = connect({ hostname: host, port: port || 3478 });
        await ctrl.opened;
        const cw = ctrl.writable.getWriter();
        const cr = ctrl.readable.getReader();
        const tid = () => crypto.getRandomValues(new Uint8Array(12));
        const tp = new Uint8Array([6, 0, 0, 0]);

        await cw.write(turnStunMsg(TURN_MT.AQ, tid(), [turnStunAttr(TURN_AT.TRANSPORT, tp)]));
        let [r, ex] = await turnReadStun(cr);
        if (!r) throw new Error('TURN Allocate request failed');

        let key = null, aa = [];
        const sign = m => (key ? turnAddIntegrity(m, key) : m);
        const peer = turnStunAttr(TURN_AT.PEER, turnXorPeer(targetIp, targetPort));

        if (r.type === TURN_MT.AE && user && turnParseErr(r.attrs[TURN_AT.ERR]) === 401) {
            const dec = new TextDecoder();
            const realm = dec.decode(r.attrs[TURN_AT.REALM] ?? new Uint8Array(0));
            const nonce = r.attrs[TURN_AT.NONCE] ?? new Uint8Array(0);
            key = await turnMd5(`${user}:${realm}:${pass}`);
            aa = [
                turnStunAttr(TURN_AT.USER, new TextEncoder().encode(user)),
                turnStunAttr(TURN_AT.REALM, new TextEncoder().encode(realm)),
                turnStunAttr(TURN_AT.NONCE, nonce)
            ];
            const [am, pm, cm] = await Promise.all([
                sign(turnStunMsg(TURN_MT.AQ, tid(), [turnStunAttr(TURN_AT.TRANSPORT, tp), ...aa])),
                sign(turnStunMsg(TURN_MT.PQ, tid(), [peer, ...aa])),
                sign(turnStunMsg(TURN_MT.CQ, tid(), [peer, ...aa]))
            ]);
            await cw.write(turnCat(am, pm, cm));
            data = connect({ hostname: host, port: port || 3478 });
            [r, ex] = await turnReadStun(cr, ex);
            if (r?.type !== TURN_MT.AO) throw new Error('TURN Allocate authentication failed');
        } else if (r.type === TURN_MT.AO) {
            const [pm, cm] = await Promise.all([
                sign(turnStunMsg(TURN_MT.PQ, tid(), [peer, ...aa])),
                sign(turnStunMsg(TURN_MT.CQ, tid(), [peer, ...aa]))
            ]);
            await cw.write(turnCat(pm, cm));
            data = connect({ hostname: host, port: port || 3478 });
        } else {
            throw new Error('TURN unexpected response type: ' + r.type);
        }

        [r, ex] = await turnReadStun(cr, ex);
        if (r?.type !== TURN_MT.PO) throw new Error('TURN CreatePermission failed');
        [r, ex] = await turnReadStun(cr, ex);
        if (r?.type !== TURN_MT.CO || !r.attrs[TURN_AT.CONNID]) throw new Error('TURN Connect failed');

        await data.opened;
        const dw = data.writable.getWriter();
        const dr = data.readable.getReader();
        await dw.write(await sign(turnStunMsg(TURN_MT.BQ, tid(), [turnStunAttr(TURN_AT.CONNID, r.attrs[TURN_AT.CONNID]), ...aa])));
        let extra;
        [r, extra] = await turnReadStun(dr);
        if (r?.type !== TURN_MT.BO) throw new Error('TURN ConnectionBind failed');

        cr.releaseLock();
        cw.releaseLock();
        dw.releaseLock();

        const readable = new ReadableStream({
            start(c) {
                if (extra?.length) c.enqueue(extra);
            },
            pull(c) {
                return dr.read().then(({ done, value }) => {
                    if (done) {
                        c.close();
                        closeAll();
                    } else {
                        c.enqueue(new Uint8Array(value));
                    }
                });
            },
            cancel() {
                dr.cancel().catch(() => {});
                closeAll();
            }
        });

        if (initialData && initialData.byteLength > 0) {
            const writer = data.writable.getWriter();
            await writer.write(initialData);
            writer.releaseLock();
        }

        return {
            readable,
            writable: data.writable,
            close: closeAll,
            closed: closedPromise
        };
    } catch (err) {
        closeAll();
        throw err;
    }
}

async function forwardataTCP(host, portNum, rawData, ws, respHeader, remoteConnWrapper, customProxyIP, request, ssInstance) {
    const connector = getSocketConnector(request);
    async function writeInitial(sock, data) {
        if (data && data.byteLength > 0) {
            const writer = sock.writable.getWriter();
            try { await writer.write(data); } finally { writer.releaseLock(); }
        }
        return sock;
    }
    async function connectDirect(address, port, data, concur = GRAIN_CFG.concur) {
        return writeInitial(await raceSprout(connector, address, port, concur), data);
    }
    // 反代：解析全部 IP，打乱后依次尝试（每个 3 秒超时，最多 3 个）
    async function connectProxyIP(address, port, data) {
        let ips = await resolveDnsAll(address);
        ips = [...ips].sort(() => Math.random() - 0.5).slice(0, 3);
        let lastErr = null;
        for (const ip of ips) {
            let sock = null;
            try {
                sock = connector.connect({ hostname: ip, port });
                await withTimeout(sock.opened, 3000, `ProxyIP ${ip}:${port} timeout`);
                return await writeInitial(sock, data);
            } catch (e) {
                lastErr = e;
                closeSocketQuietly(sock);
            }
        }
        throw lastErr || new Error('ProxyIP connect failed');
    }

    // 序号形式的参数（入口已转换，这里只兜底；越界则回退全局配置）
    if (customProxyIP && /^\d+$/.test(customProxyIP.trim())) {
        const idx = parseInt(customProxyIP.trim(), 10);
        const list = (Array.isArray(proxyIPs) && proxyIPs.length > 0) ? proxyIPs : (proxyIP ? [proxyIP] : []);
        customProxyIP = list[idx] ? list[idx].split('#')[0].replace(/^(?:ld|fd|proxyip)=/i, '').trim() : '';
    }

    const isProxyType = c => c && ['socks5', 'http', 'https', 'sstp', 'turn'].includes(c.type);
    let proxyConfig = null;
    let shouldUseProxy = false;

    // 出站决策：请求参数 > 全局落地代理 > 反代
    if (customProxyIP) {
        proxyConfig = parsePryAddress(customProxyIP);
        if (isProxyType(proxyConfig)) shouldUseProxy = true;
    }
    if (!proxyConfig) {
        const rawLanding = (Array.isArray(landingProxies) && landingProxies.length > 0) ? landingProxies[0] : landingProxy;
        const effectiveLanding = rawLanding ? rawLanding.split('#')[0].replace(/^(?:ld|fd|proxyip)=/i, '').trim() : '';
        if (effectiveLanding) {
            proxyConfig = parsePryAddress(effectiveLanding);
            if (isProxyType(proxyConfig)) shouldUseProxy = true;
        }
        const cleanProxyIP = proxyIP ? proxyIP.split('#')[0].replace(/^(?:ld|fd|proxyip)=/i, '').trim() : '';
        if (!proxyConfig && cleanProxyIP) {
            proxyConfig = parsePryAddress(cleanProxyIP) || { type: 'direct', host: cleanProxyIP, port: 443 };
            if (isProxyType(proxyConfig)) shouldUseProxy = true;
        }
    }

    const hasFallbackProxy = !!(proxyConfig && proxyConfig.host);

    // 最近直连失败过的目标，直接走反代，省掉一次失败等待
    if (!shouldUseProxy && hasFallbackProxy && isDirectFailCached(host)) shouldUseProxy = true;

    let retried = false;
    async function connecttoPry() {
        if (retried) return;
        retried = true;
        if (!proxyConfig || !proxyConfig.host) {
            throw new Error('Direct connection failed and no fallback proxy configured');
        }
        // 1. 关闭旧的直连，暂停上行写入（期间客户端数据留在队列里）
        const oldSock = remoteConnWrapper.socket;
        remoteConnWrapper.switching = true;
        remoteConnWrapper.socket = null;
        closeSocketQuietly(oldSock);

        // 2. 首包 + 直连阶段已发出的数据一起补发
        const replay = remoteConnWrapper.replay || [];
        remoteConnWrapper.replay = null;
        let payload = rawData;
        if (replay.length) {
            const total = (rawData ? rawData.byteLength : 0) + replay.reduce((n, x) => n + x.byteLength, 0);
            payload = new Uint8Array(total);
            let o = 0;
            if (rawData && rawData.byteLength) { payload.set(rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData), 0); o = rawData.byteLength; }
            for (const x of replay) { payload.set(x, o); o += x.byteLength; }
        }

        let newSocket;
        try {
            if (proxyConfig.type === 'socks5') {
                newSocket = await connect2Socks5(proxyConfig, host, portNum, payload);
            } else if (proxyConfig.type === 'http' || proxyConfig.type === 'https') {
                newSocket = await connect2Http(proxyConfig, host, portNum, payload);
            } else if (proxyConfig.type === 'sstp') {
                newSocket = await connect2Sstp(proxyConfig, host, portNum, payload);
            } else if (proxyConfig.type === 'turn') {
                newSocket = await connect2Turn(proxyConfig, host, portNum, payload);
            } else {
                newSocket = await connectProxyIP(proxyConfig.host, proxyConfig.port, payload);
            }
        } catch (e) {
            remoteConnWrapper.switching = false;
            closeSocketQuietly(ws);
            throw e;
        }
        remoteConnWrapper.switching = false;
        // 客户端在切换过程中已经断开：直接释放新连接
        if (ws.readyState !== WS_READY_STATE_OPEN) {
            closeSocketQuietly(newSocket);
            return;
        }
        remoteConnWrapper.socket = newSocket;
        newSocket.closed?.catch(() => {}).finally(() => closeSocketQuietly(ws));
        connectStreams(newSocket, ws, respHeader, null, ssInstance);
        // 3. 把切换期间排队的上行数据继续发出去
        if (remoteConnWrapper.flush) remoteConnWrapper.flush();
    }

    if (shouldUseProxy) {
        await connecttoPry();
        return;
    }
    try {
        // 直连阶段开启“已发数据记录”，以便切反代时补发
        remoteConnWrapper.replay = hasFallbackProxy ? [] : null;
        remoteConnWrapper.replayBytes = 0;
        const initialSocket = await connectDirect(host, portNum, rawData, GRAIN_CFG.concur);
        remoteConnWrapper.socket = initialSocket;
        const retry = hasFallbackProxy ? async () => { markDirectFail(host); await connecttoPry(); } : null;
        connectStreams(initialSocket, ws, respHeader, retry, ssInstance, () => { remoteConnWrapper.replay = null; });
    } catch (err) {
        remoteConnWrapper.socket = null;
        if (hasFallbackProxy) {
            markDirectFail(host);
            await connecttoPry();
        } else {
            remoteConnWrapper.replay = null;
            throw err;
        }
    }
}

function parseVLsPacketHeader(chunk, token, tokenBytes) {
    if (!chunk || chunk.byteLength < 24) return { hasError: true, message: 'Truncated header' };
    const chunkView = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    const version = chunkView.subarray(0, 1);
    if (tokenBytes) {
        if (!matchUUID(chunkView, 1, tokenBytes)) return { hasError: true, message: 'Invalid uuid' };
    } else {
        if (formatIdentifier(chunkView.slice(1, 17)) !== token) return { hasError: true, message: 'Invalid uuid' };
    }
    const optLen = chunkView[17];
    if (chunkView.byteLength < 22 + optLen) return { hasError: true, message: 'Truncated VLESS header' };
    const cmd = chunkView[18 + optLen];
    let isUDP = false;
    if (cmd === 1) {} else if (cmd === 2) { isUDP = true; } else { return { hasError: true, message: 'Invalid command' }; }
    const portIdx = 19 + optLen;
    const port = (chunkView[portIdx] << 8) | chunkView[portIdx + 1];
    let addrIdx = portIdx + 2, addrLen = 0, addrValIdx = addrIdx + 1, hostname = '';
    const addressType = chunkView[addrIdx];
    switch (addressType) {
        case 1:
            addrLen = 4;
            if (addrValIdx + addrLen > chunkView.byteLength) return { hasError: true, message: 'Truncated IPv4' };
            hostname = chunkView.subarray(addrValIdx, addrValIdx + 4).join('.');
            break;
        case 2:
            if (addrValIdx >= chunkView.byteLength) return { hasError: true, message: 'Truncated domain len' };
            addrLen = chunkView[addrValIdx];
            addrValIdx += 1;
            if (addrValIdx + addrLen > chunkView.byteLength) return { hasError: true, message: 'Truncated domain' };
            hostname = dec_ss.decode(chunkView.subarray(addrValIdx, addrValIdx + addrLen));
            break;
        case 3: {
            addrLen = 16;
            if (addrValIdx + addrLen > chunkView.byteLength) return { hasError: true, message: 'Truncated IPv6' };
            const ipv6 = [];
            const ipv6View = new DataView(chunkView.buffer, chunkView.byteOffset + addrValIdx, 16);
            for (let i = 0; i < 8; i++) ipv6.push(ipv6View.getUint16(i * 2).toString(16));
            hostname = ipv6.join(':');
            break;
        }
        default:
            return { hasError: true, message: `Invalid address type: ${addressType}` };
    }
    if (!hostname) return { hasError: true, message: `Invalid address: ${addressType}` };
    return { hasError: false, addressType, port, hostname, isUDP, rawIndex: addrValIdx + addrLen, version };
}

function parseSSPacketHeader(chunk) {
    if (chunk.byteLength < 7) return { hasError: true, message: 'Invalid data' };
    try {
        const view = new Uint8Array(chunk);
        const addressType = view[0];
        let addrIdx = 1, addrLen = 0, addrValIdx = addrIdx, hostname = '';
        switch (addressType) {
            case 1: // IPv4
                addrLen = 4; 
                hostname = new Uint8Array(chunk.slice(addrValIdx, addrValIdx + addrLen)).join('.'); 
                addrValIdx += addrLen;
                break;
            case 3: // Domain
                addrLen = view[addrIdx];
                addrValIdx += 1; 
                hostname = new TextDecoder().decode(chunk.slice(addrValIdx, addrValIdx + addrLen)); 
                addrValIdx += addrLen;
                break;
            case 4: // IPv6
                addrLen = 16; 
                const ipv6 = []; 
                const ipv6View = new DataView(chunk.slice(addrValIdx, addrValIdx + addrLen)); 
                for (let i = 0; i < 8; i++) ipv6.push(ipv6View.getUint16(i * 2).toString(16)); 
                hostname = ipv6.join(':'); 
                addrValIdx += addrLen;
                break;
            default: 
                return { hasError: true, message: `Invalid address type: ${addressType}` };
        }
        if (!hostname) return { hasError: true, message: `Invalid address: ${addressType}` };
        const port = new DataView(chunk.slice(addrValIdx, addrValIdx + 2)).getUint16(0);
        return { hasError: false, addressType, port, hostname, rawIndex: addrValIdx + 2 };
    } catch (e) {
        return { hasError: true, message: 'Failed to parse SS packet header' };
    }
}

function makeReadableStr(socket, earlyDataHeader) {
    let cancelled = false;
    return new ReadableStream({
        start(controller) {
            socket.addEventListener('message', async (event) => {
                if (cancelled) return;
                let data = event.data;
                if (data instanceof Blob) {
                    data = await data.arrayBuffer();
                }
                controller.enqueue(data);
            });
            socket.addEventListener('close', () => { 
                if (!cancelled) { 
                    closeSocketQuietly(socket); 
                    controller.close(); 
                } 
            });
            socket.addEventListener('error', (err) => controller.error(err));
            const { earlyData, error } = base64ToArray(earlyDataHeader);
            if (error) {
                Promise.resolve().then(() => controller.error(error));
            } else if (earlyData) {
                Promise.resolve().then(() => {
                    if (!cancelled) controller.enqueue(earlyData);
                });
            }
        },
        cancel() { 
            cancelled = true; 
            closeSocketQuietly(socket); 
        }
    });
}

async function connectStreams(remoteSocket, webSocket, headerData, retryFunc, ssInstance, onFirstData) {
    let header = headerData, hasData = false;

    async function sendChunk(data) {
        if (!hasData && onFirstData) { try { onFirstData(); } catch (e) {} }
        hasData = true;
        if (webSocket.readyState !== WS_READY_STATE_OPEN) {
            throw new Error('ws.readyState is not open');
        }
        let dataToSend = data;
        if (header) {
            const combined = new Uint8Array(header.length + data.byteLength);
            combined.set(header, 0);
            combined.set(data, header.length);
            dataToSend = combined;
            header = null;
        }
        if (ssInstance) {
            const enc = await ssInstance.encData(dataToSend instanceof Uint8Array ? dataToSend : new Uint8Array(dataToSend));
            webSocket.send(enc.buffer ? enc.buffer : enc);
        } else {
            webSocket.send(dataToSend);
        }
    }

    const tx = mkDn(webSocket, sendChunk);
    const rd = remoteSocket?.readable;
    if (!rd) {
        if (retryFunc && webSocket.readyState === WS_READY_STATE_OPEN) await retryFunc();
        else closeSocketQuietly(webSocket);
        return;
    }

    let r = null;
    let isByob = true;
    try {
        r = rd.getReader({ mode: 'byob' });
    } catch (e) {
        isByob = false;
        r = rd.getReader();
    }

    let buf = isByob ? new ArrayBuffer(GRAIN_CFG.chunk) : null;
    try {
        for (;;) {
            if (webSocket.readyState !== WS_READY_STATE_OPEN) break;
            let done, v;
            if (isByob) {
                const res = await r.read(new Uint8Array(buf, 0, GRAIN_CFG.chunk));
                done = res.done;
                v = res.value;
            } else {
                const res = await r.read();
                done = res.done;
                v = res.value;
            }
            if (done) break;
            if (!v?.byteLength) continue;

            // 大包 (>= 32KB): 直发并换新 Buffer
            if (v.byteLength >= (GRAIN_CFG.chunk >> 1)) {
                await tx.reap();
                await sendChunk(v);
                if (isByob) buf = new ArrayBuffer(GRAIN_CFG.chunk);
            } else {
                // 小包 (< 32KB): 聚合发出
                tx.send(v.slice());
                if (isByob) buf = v.buffer;
            }
        }
        await tx.reap();
    } catch (err) {
        if (hasData || !retryFunc) closeSocketQuietly(webSocket);
    } finally {
        try { await tx.reap(); } catch (e) {}
        try { r?.releaseLock(); } catch (e) {}
    }

    // 仅在：没收到任何数据 + 客户端仍在线 时才切换反代重试
    if (!hasData && retryFunc && webSocket.readyState === WS_READY_STATE_OPEN) {
        await retryFunc();
    }
}

async function resolveRawDnsWire(dnsQueryBytes) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
        const resp = await fetch('https://1.1.1.1/dns-query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/dns-message',
                'Accept': 'application/dns-message'
            },
            body: dnsQueryBytes,
            signal: controller.signal
        });
        if (resp.ok) {
            return new Uint8Array(await resp.arrayBuffer());
        }
    } catch (e) {
        // 降级到 TCP 53 兜底
    } finally {
        clearTimeout(timer);
    }
    let tcpSocket = null;
    try {
        tcpSocket = connect({ hostname: '8.8.4.4', port: 53 });
        const tcpFrame = new Uint8Array(2 + dnsQueryBytes.byteLength);
        tcpFrame[0] = (dnsQueryBytes.byteLength >> 8) & 0xff;
        tcpFrame[1] = dnsQueryBytes.byteLength & 0xff;
        tcpFrame.set(dnsQueryBytes, 2);
        const writer = tcpSocket.writable.getWriter();
        await writer.write(tcpFrame);
        writer.releaseLock();
        const reader = tcpSocket.readable.getReader();
        let buf = new Uint8Array(0);
        while (buf.byteLength < 2) {
            const { done, value } = await reader.read();
            if (done) break;
            buf = cat_ss(buf, value instanceof Uint8Array ? value : new Uint8Array(value));
        }
        if (buf.byteLength >= 2) {
            const expected = 2 + ((buf[0] << 8) | buf[1]);
            while (buf.byteLength < expected) {
                const { done, value } = await reader.read();
                if (done) break;
                buf = cat_ss(buf, value instanceof Uint8Array ? value : new Uint8Array(value));
            }
            reader.releaseLock();
            return buf.subarray(2, expected);
        }
        reader.releaseLock();
    } catch (e) {
    } finally {
        closeSocketQuietly(tcpSocket);
    }
    return null;
}

async function forwardataudp(udpChunk, webSocket, respHeader, ssInstance) {
    if (!udpChunk || !udpChunk.byteLength) return;
    try {
        const u8 = udpChunk instanceof Uint8Array ? udpChunk : new Uint8Array(udpChunk);
        let vlessHeader = respHeader;
        // 判断是否为带 2 字节长度前缀的 VLESS UDP DNS 帧
        if (!ssInstance && u8.byteLength >= 14) {
            const firstLen = (u8[0] << 8) | u8[1];
            if (firstLen >= 12 && firstLen <= u8.byteLength - 2) {
                let offset = 0;
                while (offset + 2 <= u8.byteLength) {
                    const qLen = (u8[offset] << 8) | u8[offset + 1];
                    if (qLen <= 0 || offset + 2 + qLen > u8.byteLength) break;
                    const qData = u8.subarray(offset + 2, offset + 2 + qLen);
                    offset += 2 + qLen;
                    const ans = await resolveRawDnsWire(qData);
                    if (ans && webSocket.readyState === WS_READY_STATE_OPEN) {
                        const hLen = vlessHeader ? vlessHeader.length : 0;
                        const pkt = new Uint8Array(hLen + 2 + ans.byteLength);
                        if (vlessHeader) {
                            pkt.set(vlessHeader, 0);
                            vlessHeader = null;
                        }
                        pkt[hLen] = (ans.byteLength >> 8) & 0xff;
                        pkt[hLen + 1] = ans.byteLength & 0xff;
                        pkt.set(ans, hLen + 2);
                        webSocket.send(pkt);
                    }
                }
                return;
            }
        }
        const ans = await resolveRawDnsWire(u8);
        if (ans && webSocket.readyState === WS_READY_STATE_OPEN) {
            let dataToSend = ans;
            if (vlessHeader) {
                const combined = new Uint8Array(vlessHeader.length + ans.byteLength);
                combined.set(vlessHeader, 0);
                combined.set(ans, vlessHeader.length);
                dataToSend = combined;
            }
            if (ssInstance) {
                const enc = await ssInstance.encData(dataToSend);
                webSocket.send(enc.buffer ? enc.buffer : enc);
            } else {
                webSocket.send(dataToSend);
            }
        }
    } catch (error) {}
}

async function forwardTrojanUdpDns(trojanChunk, webSocket) {
    if (!trojanChunk || !trojanChunk.byteLength) return;
    try {
        const u8 = trojanChunk instanceof Uint8Array ? trojanChunk : new Uint8Array(trojanChunk);
        let offset = 0;
        while (offset + 8 <= u8.byteLength) {
            const atyp = u8[offset];
            let addrPortLen = 0;
            if (atyp === 1) addrPortLen = 7;
            else if (atyp === 3) addrPortLen = 4 + u8[offset + 1];
            else if (atyp === 4) addrPortLen = 19;
            else break;
            if (offset + addrPortLen + 4 > u8.byteLength) break;
            const addrHeader = u8.subarray(offset, offset + addrPortLen);
            const dstPort = (addrHeader[addrHeader.length - 2] << 8) | addrHeader[addrHeader.length - 1];
            const payloadLen = (u8[offset + addrPortLen] << 8) | u8[offset + addrPortLen + 1];
            const payloadStart = offset + addrPortLen + 4;
            if (payloadStart + payloadLen > u8.byteLength) break;
            const payload = u8.subarray(payloadStart, payloadStart + payloadLen);
            offset = payloadStart + payloadLen;
            if (dstPort === 53 && payload.byteLength >= 12) {
                const ans = await resolveRawDnsWire(payload);
                if (ans && webSocket.readyState === WS_READY_STATE_OPEN) {
                    const respPkt = new Uint8Array(addrHeader.length + 4 + ans.byteLength);
                    respPkt.set(addrHeader, 0);
                    respPkt[addrHeader.length] = (ans.byteLength >> 8) & 0xff;
                    respPkt[addrHeader.length + 1] = ans.byteLength & 0xff;
                    respPkt[addrHeader.length + 2] = 0x0d;
                    respPkt[addrHeader.length + 3] = 0x0a;
                    respPkt.set(ans, addrHeader.length + 4);
                    webSocket.send(respPkt);
                }
            }
        }
    } catch (e) {}
}

// ------------------------- 统一节点生成与原生订阅转换引擎 (Sing-box 1.14 / FlClash / 原版 Clash) -------------------------
function parseCdnHostPort(cdnItem) {
    let host = '', port = 443, cdnName = '', cdnItemClean = String(cdnItem).trim();
    if (cdnItemClean.includes('#')) {
        const idx = cdnItemClean.indexOf('#');
        cdnName = cdnItemClean.substring(idx + 1).trim();
        cdnItemClean = cdnItemClean.substring(0, idx).trim();
    }
    if (cdnItemClean.startsWith('[') && cdnItemClean.includes(']:')) {
        const ipv6End = cdnItemClean.indexOf(']:');
        host = cdnItemClean.substring(0, ipv6End + 1);
        port = parseInt(cdnItemClean.substring(ipv6End + 2), 10) || 443;
    } else if (cdnItemClean.startsWith('[') && cdnItemClean.endsWith(']')) {
        host = cdnItemClean;
        port = 443;
    } else if (cdnItemClean.includes(':')) {
        const parts = cdnItemClean.split(':');
        host = parts[0];
        port = parseInt(parts[1], 10) || 443;
    } else {
        host = cdnItemClean;
    }
    const cleanHost = (host.startsWith('[') && host.endsWith(']')) ? host.slice(1, -1) : host;
    return { uriHost: host, cleanHost, port, cdnName };
}

async function buildAllNodes(config, currentDomain, validSSPath) {
    const vlsHeader = 'v' + 'l' + 'e' + 's' + 's';
    const troHeader = 't' + 'r' + 'o' + 'j' + 'a' + 'n';
    const ssHeader = 's' + 's';
    const resolvedCfip = await resolveCfipList(config.cfip);
    const multiCdn = resolvedCfip.length > 1;

    const rawLandingList = (Array.isArray(config.landingProxies) && config.landingProxies.length > 0)
        ? config.landingProxies
        : (config.landingProxy ? [config.landingProxy] : []);
    const rawProxyList = (Array.isArray(config.proxyIPs) && config.proxyIPs.length > 0)
        ? config.proxyIPs
        : (config.proxyIP ? [config.proxyIP] : []);

    const isLandingMode = rawLandingList.length > 0;
    const rawActiveList = isLandingMode ? rawLandingList : rawProxyList;
    const parsedProxies = rawActiveList.map((item, idx) => {
        let rawItem = String(item).trim();
        let proxyTag = '';
        if (rawItem.includes('#')) {
            const hIdx = rawItem.indexOf('#');
            proxyTag = rawItem.substring(hIdx + 1).trim();
            rawItem = rawItem.substring(0, hIdx).trim();
        }
        const cleanAddr = rawItem.replace(/^(?:ld|fd|proxyip)=/i, '').trim();
        return { proxyAddr: cleanAddr, proxyTag, index: idx, hasRemark: !!proxyTag };
    }).filter(p => p.proxyAddr);

    const effectiveProxies = parsedProxies.length > 0 ? parsedProxies : [{ proxyAddr: '', proxyTag: '', index: 0, hasRemark: false }];
    const needIndexRouting = parsedProxies.length > 1 || (parsedProxies.length === 1 && parsedProxies[0].hasRemark);
    const prefix = isLandingMode ? 'ld' : 'fd';
    const usedNames = new Set();

    function makeUniqueName(protoLabel, proxy, cdnName, cleanHost) {
        let base = '';
        if (proxy.hasRemark && cdnName) {
            base = `${protoLabel}-${proxy.proxyTag}-${cdnName}`;
        } else if (proxy.hasRemark) {
            base = multiCdn ? `${protoLabel}-${proxy.proxyTag}-${cleanHost}` : `${protoLabel}-${proxy.proxyTag}`;
        } else if (cdnName) {
            base = `${cdnName}-${protoLabel}`;
        } else {
            base = multiCdn ? `${protoLabel}-${cleanHost}` : `Workers-${protoLabel}`;
        }
        let candidate = base;
        let seq = 2;
        while (usedNames.has(candidate)) {
            candidate = `${base} #${seq++}`;
        }
        usedNames.add(candidate);
        return candidate;
    }

    const nodes = [];

    if (!config.disablevless) {
        for (const cdnItem of resolvedCfip) {
            const { uriHost, cleanHost, port, cdnName } = parseCdnHostPort(cdnItem);
            if (!cleanHost) continue;
            for (const proxy of effectiveProxies) {
                const name = makeUniqueName('VLESS', proxy, cdnName, cleanHost);
                const hasIdx = proxy.proxyAddr && needIndexRouting;
                const wsPath = hasIdx ? `/?ed=2560&${prefix}=${proxy.index}` : '/?ed=2560';
                const cleanWsPath = hasIdx ? `/?${prefix}=${proxy.index}` : '/';
                const uri = `${vlsHeader}://${config.yourUUID}@${uriHost}:${port}?encryption=none&security=tls&sni=${currentDomain}&fp=firefox&allowInsecure=0&type=ws&host=${currentDomain}&path=${encodeURIComponent(wsPath)}#${encodeURIComponent(name)}`;
                nodes.push({ protocol: 'vless', name, cleanHost, uriHost, port, uuid: config.yourUUID, tls: true, sni: currentDomain, wsHost: currentDomain, wsPath, cleanWsPath, uri });
            }
        }
    }

    if (!config.disabletro) {
        for (const cdnItem of resolvedCfip) {
            const { uriHost, cleanHost, port, cdnName } = parseCdnHostPort(cdnItem);
            if (!cleanHost) continue;
            for (const proxy of effectiveProxies) {
                const name = makeUniqueName('Trojan', proxy, cdnName, cleanHost);
                const hasIdx = proxy.proxyAddr && needIndexRouting;
                const wsPath = hasIdx ? `/?ed=2560&${prefix}=${proxy.index}` : '/?ed=2560';
                const cleanWsPath = hasIdx ? `/?${prefix}=${proxy.index}` : '/';
                const uri = `${troHeader}://${config.yourUUID}@${uriHost}:${port}?security=tls&sni=${currentDomain}&fp=firefox&allowInsecure=0&type=ws&host=${currentDomain}&path=${encodeURIComponent(wsPath)}&wspath=${encodeURIComponent(wsPath)}#${encodeURIComponent(name)}`;
                nodes.push({ protocol: 'trojan', name, cleanHost, uriHost, port, password: config.yourUUID, tls: true, sni: currentDomain, wsHost: currentDomain, wsPath, cleanWsPath, uri });
            }
        }
    }

    if (!config.disabless) {
        const method = config.ssMethod || 'aes-256-gcm';
        const methodInfo = C_SS[method] || C_SS['aes-256-gcm'];
        const rawSecret = config.ssPsk || config.yourUUID;
        const effectivePassword = methodInfo.b3 ? await deriveSS_Psk(rawSecret, methodInfo.k) : rawSecret;
        const encodedConfig = btoa(`${method}:${effectivePassword}`);
        for (const cdnItem of resolvedCfip) {
            const { uriHost, cleanHost, port, cdnName } = parseCdnHostPort(cdnItem);
            if (!cleanHost) continue;
            const isHttpPort = [80, 8080, 8880, 2052, 2082, 2086, 2095].includes(port);
            for (const proxy of effectiveProxies) {
                const name = makeUniqueName('SS', proxy, cdnName, cleanHost);
                const hasIdx = proxy.proxyAddr && needIndexRouting;
                const ssWsPath = hasIdx ? `${validSSPath}/?ed=2560&${prefix}=${proxy.index}` : `${validSSPath}/?ed=2560`;
                const pluginParam = isHttpPort
                    ? `plugin=v2ray-plugin;mode%3Dwebsocket;host%3D${currentDomain};path%3D${encodeURIComponent(ssWsPath)};mux%3D0`
                    : `plugin=v2ray-plugin;mode%3Dwebsocket;host%3D${currentDomain};path%3D${encodeURIComponent(ssWsPath)};tls;sni%3D${currentDomain};skip-cert-verify%3Dtrue;mux%3D0`;
                const uri = `${ssHeader}://${encodedConfig}@${uriHost}:${port}?${pluginParam}#${encodeURIComponent(name)}`;
                nodes.push({ protocol: 'ss', name, cleanHost, uriHost, port, cipher: method, password: effectivePassword, isSS2022: !!methodInfo.b3, tls: !isHttpPort, sni: currentDomain, wsHost: currentDomain, wsPath: ssWsPath, uri });
            }
        }
    }

    return nodes;
}

function generateSingboxConfig(nodes) {
    const proxyOutbounds = [];
    for (const n of nodes) {
        if (n.protocol === 'vless') {
            proxyOutbounds.push({
                type: 'vless',
                tag: n.name,
                server: n.cleanHost,
                server_port: n.port,
                uuid: n.uuid,
                tls: { enabled: true, server_name: n.sni, insecure: false, utls: { enabled: true, fingerprint: 'firefox' } },
                transport: { type: 'ws', path: n.cleanWsPath, headers: { Host: n.wsHost }, max_early_data: 2560, early_data_header_name: 'Sec-WebSocket-Protocol' }
            });
        } else if (n.protocol === 'trojan') {
            proxyOutbounds.push({
                type: 'trojan',
                tag: n.name,
                server: n.cleanHost,
                server_port: n.port,
                password: n.password,
                tls: { enabled: true, server_name: n.sni, insecure: false, utls: { enabled: true, fingerprint: 'firefox' } },
                transport: { type: 'ws', path: n.cleanWsPath, headers: { Host: n.wsHost } }
            });
        } else if (n.protocol === 'ss') {
            proxyOutbounds.push({
                type: 'shadowsocks',
                tag: n.name,
                server: n.cleanHost,
                server_port: n.port,
                method: n.cipher,
                password: n.password,
                plugin: 'v2ray-plugin',
                plugin_opts: n.tls
                    ? `tls;mode=websocket;host=${n.wsHost};path=${n.wsPath};mux=0`
                    : `mode=websocket;host=${n.wsHost};path=${n.wsPath};mux=0`
            });
        }
    }
    const nodeTags = proxyOutbounds.map(o => o.tag);
    const hasNodes = nodeTags.length > 0;
    const selectorGroup = {
        type: 'selector',
        tag: '🚀 节点选择',
        outbounds: hasNodes ? ['⚡ 自动选择', ...nodeTags, 'direct'] : ['direct'],
        default: hasNodes ? '⚡ 自动选择' : 'direct'
    };
    const outbounds = [selectorGroup];
    if (hasNodes) {
        outbounds.push({
            type: 'urltest',
            tag: '⚡ 自动选择',
            outbounds: [...nodeTags],
            url: 'https://www.gstatic.com/generate_204',
            interval: '5m',
            tolerance: 50
        });
    }
    outbounds.push(...proxyOutbounds, { type: 'direct', tag: 'direct' });

    // 严格遵循 Sing-box 1.14+ 最新架构规范 (新版 dns.servers / 顶层 http_clients / default_domain_resolver / route action)
    return {
        log: { level: 'info', timestamp: true },
        http_clients: [{ tag: 'proxy-http', detour: '🚀 节点选择' }],
        dns: {
            servers: [
                { tag: 'dns-local', type: 'udp', server: '223.5.5.5', server_port: 53 },
                { tag: 'dns-remote', type: 'https', server: '1.1.1.1', server_port: 443, path: '/dns-query', detour: '🚀 节点选择' }
            ],
            rules: [
                { rule_set: 'geosite-cn', server: 'dns-local' }
            ],
            final: 'dns-remote',
            strategy: 'prefer_ipv4'
        },
        inbounds: [
            {
                type: 'tun',
                tag: 'tun-in',
                address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
                auto_route: true,
                strict_route: false
            },
            {
                type: 'mixed',
                tag: 'mixed-in',
                listen: '127.0.0.1',
                listen_port: 2080
            }
        ],
        outbounds,
        route: {
            default_domain_resolver: 'dns-local',
            default_http_client: 'proxy-http',
            auto_detect_interface: true,
            rules: [
                { action: 'sniff' },
                { protocol: 'dns', action: 'hijack-dns' },
                { ip_is_private: true, outbound: 'direct' },
                { rule_set: 'geosite-ads', action: 'reject' },
                { rule_set: ['geosite-cn', 'geoip-cn'], outbound: 'direct' }
            ],
            rule_set: [
                { tag: 'geosite-ads', type: 'remote', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ads-all.srs' },
                { tag: 'geosite-cn', type: 'remote', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs' },
                { tag: 'geoip-cn', type: 'remote', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs' }
            ],
            final: '🚀 节点选择'
        }
    };
}

const CLASSIC_CLASH_SS_CIPHERS = new Set([
    'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm',
    'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305',
    'aes-128-cfb', 'aes-192-cfb', 'aes-256-cfb',
    'aes-128-ctr', 'aes-192-ctr', 'aes-256-ctr', 'rc4-md5'
]);

function generateClashConfig(nodes, isMeta = true) {
    const clashProxies = [];
    for (const n of nodes) {
        if (n.protocol === 'vless') {
            if (!isMeta) continue; // 原版 Clash 不支持 VLESS，自动过滤避免整份配置报错
            clashProxies.push({
                name: n.name,
                type: 'vless',
                server: n.cleanHost,
                port: n.port,
                uuid: n.uuid,
                udp: true,
                tls: true,
                'skip-cert-verify': false,
                servername: n.sni,
                'client-fingerprint': 'firefox',
                network: 'ws',
                'ws-opts': {
                    path: n.cleanWsPath,
                    headers: { Host: n.wsHost },
                    'max-early-data': 2560,
                    'early-data-header-name': 'Sec-WebSocket-Protocol'
                }
            });
        } else if (n.protocol === 'trojan') {
            const p = {
                name: n.name,
                type: 'trojan',
                server: n.cleanHost,
                port: n.port,
                password: n.password,
                udp: true,
                sni: n.sni,
                'skip-cert-verify': false,
                network: 'ws',
                'ws-opts': {
                    path: n.cleanWsPath,
                    headers: { Host: n.wsHost }
                }
            };
            if (isMeta) p['client-fingerprint'] = 'firefox';
            clashProxies.push(p);
        } else if (n.protocol === 'ss') {
            if (!isMeta && !CLASSIC_CLASH_SS_CIPHERS.has(n.cipher)) continue;
            clashProxies.push({
                name: n.name,
                type: 'ss',
                server: n.cleanHost,
                port: n.port,
                cipher: n.cipher,
                password: n.password,
                udp: true,
                plugin: 'v2ray-plugin',
                'plugin-opts': {
                    mode: 'websocket',
                    tls: n.tls,
                    'skip-cert-verify': false,
                    host: n.wsHost,
                    path: n.wsPath,
                    mux: false
                }
            });
        }
    }

    const proxyNames = clashProxies.map(p => p.name);
    const hasProxies = proxyNames.length > 0;
    const groupMembers = hasProxies ? proxyNames : ['DIRECT'];
    const selectMembers = hasProxies ? ['⚡ 自动选择', '🔯 故障转移', ...proxyNames, 'DIRECT'] : ['DIRECT'];

    const lines = [
        `# Generated by Cloudflare Workers (${isMeta ? 'Mihomo / FlClash Full Mode' : 'Classic Clash Compatible Mode'})`,
        'mixed-port: 7890',
        'allow-lan: true',
        'bind-address: "*"',
        'mode: rule',
        'log-level: info',
        'ipv6: true',
        'external-controller: 127.0.0.1:9090',
        'dns:',
        '  enable: true',
        '  ipv6: false',
        '  enhanced-mode: fake-ip',
        '  fake-ip-range: 198.18.0.1/16',
        '  fake-ip-filter:',
        '    - "*.lan"',
        '    - "+.msftconnecttest.com"',
        '    - "+.msftncsi.com"',
        '    - "localhost.ptlogin2.qq.com"',
        '  default-nameserver:',
        '    - 223.5.5.5',
        '    - 119.29.29.29',
        '  nameserver:',
        '    - https://dns.alidns.com/dns-query',
        '    - https://doh.pub/dns-query',
        'proxies:'
    ];
    if (!hasProxies) {
        lines[lines.length - 1] = 'proxies: []';
    } else {
        for (const p of clashProxies) {
            lines.push(`  - ${JSON.stringify(p)}`);
        }
    }

    lines.push('proxy-groups:');
    lines.push(`  - ${JSON.stringify({ name: '🚀 节点选择', type: 'select', proxies: selectMembers })}`);
    if (hasProxies) {
        lines.push(`  - ${JSON.stringify({ name: '⚡ 自动选择', type: 'url-test', proxies: groupMembers, url: 'https://www.gstatic.com/generate_204', interval: 300, tolerance: 50 })}`);
        lines.push(`  - ${JSON.stringify({ name: '🔯 故障转移', type: 'fallback', proxies: groupMembers, url: 'https://www.gstatic.com/generate_204', interval: 300 })}`);
    }
    lines.push(`  - ${JSON.stringify({ name: '🎯 全球直连', type: 'select', proxies: ['DIRECT', '🚀 节点选择'] })}`);
    lines.push(`  - ${JSON.stringify({ name: '🛑 广告拦截', type: 'select', proxies: ['REJECT', 'DIRECT'] })}`);
    lines.push(`  - ${JSON.stringify({ name: '🐟 漏网之鱼', type: 'select', proxies: ['🚀 节点选择', '🎯 全球直连'] })}`);

    // 100% 同时兼容原版 Clash 与 FlClash/Mihomo 的高速内置分流规则 (不含会导致原版 Clash 报错的 GEOSITE)
    const rules = [
        'DOMAIN-SUFFIX,local,🎯 全球直连',
        'IP-CIDR,127.0.0.0/8,🎯 全球直连,no-resolve',
        'IP-CIDR,10.0.0.0/8,🎯 全球直连,no-resolve',
        'IP-CIDR,172.16.0.0/12,🎯 全球直连,no-resolve',
        'IP-CIDR,192.168.0.0/16,🎯 全球直连,no-resolve',
        'IP-CIDR,100.64.0.0/10,🎯 全球直连,no-resolve',
        'DOMAIN-KEYWORD,adservice,🛑 广告拦截',
        'DOMAIN-SUFFIX,doubleclick.net,🛑 广告拦截',
        'DOMAIN-SUFFIX,googlesyndication.com,🛑 广告拦截',
        'DOMAIN-SUFFIX,googleadservices.com,🛑 广告拦截',
        'DOMAIN-SUFFIX,app-measurement.com,🛑 广告拦截',
        'DOMAIN-SUFFIX,cn,🎯 全球直连',
        'DOMAIN-KEYWORD,-cn,🎯 全球直连',
        'DOMAIN-SUFFIX,baidu.com,🎯 全球直连',
        'DOMAIN-SUFFIX,bdstatic.com,🎯 全球直连',
        'DOMAIN-SUFFIX,qq.com,🎯 全球直连',
        'DOMAIN-SUFFIX,wechat.com,🎯 全球直连',
        'DOMAIN-SUFFIX,weixin.qq.com,🎯 全球直连',
        'DOMAIN-SUFFIX,gtimg.cn,🎯 全球直连',
        'DOMAIN-SUFFIX,myqcloud.com,🎯 全球直连',
        'DOMAIN-SUFFIX,taobao.com,🎯 全球直连',
        'DOMAIN-SUFFIX,tmall.com,🎯 全球直连',
        'DOMAIN-SUFFIX,alicdn.com,🎯 全球直连',
        'DOMAIN-SUFFIX,aliyun.com,🎯 全球直连',
        'DOMAIN-SUFFIX,alipay.com,🎯 全球直连',
        'DOMAIN-SUFFIX,jd.com,🎯 全球直连',
        'DOMAIN-SUFFIX,360buyimg.com,🎯 全球直连',
        'DOMAIN-SUFFIX,bilibili.com,🎯 全球直连',
        'DOMAIN-SUFFIX,bilivideo.com,🎯 全球直连',
        'DOMAIN-SUFFIX,hdslb.com,🎯 全球直连',
        'DOMAIN-SUFFIX,163.com,🎯 全球直连',
        'DOMAIN-SUFFIX,126.net,🎯 全球直连',
        'DOMAIN-SUFFIX,bytedance.com,🎯 全球直连',
        'DOMAIN-SUFFIX,douyin.com,🎯 全球直连',
        'DOMAIN-SUFFIX,toutiao.com,🎯 全球直连',
        'DOMAIN-SUFFIX,weibo.com,🎯 全球直连',
        'DOMAIN-SUFFIX,zhihu.com,🎯 全球直连',
        'DOMAIN-SUFFIX,xiaohongshu.com,🎯 全球直连',
        'DOMAIN-SUFFIX,meituan.com,🎯 全球直连',
        'DOMAIN-SUFFIX,mi.com,🎯 全球直连',
        'DOMAIN-SUFFIX,icloud.com.cn,🎯 全球直连',
        'DOMAIN-SUFFIX,apple.com.cn,🎯 全球直连',
        'DOMAIN-SUFFIX,google.com,🚀 节点选择',
        'DOMAIN-SUFFIX,googleapis.com,🚀 节点选择',
        'DOMAIN-SUFFIX,gstatic.com,🚀 节点选择',
        'DOMAIN-SUFFIX,youtube.com,🚀 节点选择',
        'DOMAIN-SUFFIX,ytimg.com,🚀 节点选择',
        'DOMAIN-SUFFIX,googlevideo.com,🚀 节点选择',
        'DOMAIN-SUFFIX,github.com,🚀 节点选择',
        'DOMAIN-SUFFIX,githubusercontent.com,🚀 节点选择',
        'DOMAIN-SUFFIX,openai.com,🚀 节点选择',
        'DOMAIN-SUFFIX,chatgpt.com,🚀 节点选择',
        'DOMAIN-SUFFIX,anthropic.com,🚀 节点选择',
        'DOMAIN-SUFFIX,claude.ai,🚀 节点选择',
        'DOMAIN-SUFFIX,x.com,🚀 节点选择',
        'DOMAIN-SUFFIX,twitter.com,🚀 节点选择',
        'DOMAIN-SUFFIX,twimg.com,🚀 节点选择',
        'DOMAIN-SUFFIX,telegram.org,🚀 节点选择',
        'DOMAIN-SUFFIX,t.me,🚀 节点选择',
        'DOMAIN-SUFFIX,netflix.com,🚀 节点选择',
        'DOMAIN-SUFFIX,nflxvideo.net,🚀 节点选择',
        'DOMAIN-SUFFIX,wikipedia.org,🚀 节点选择',
        'IP-CIDR,91.108.4.0/22,🚀 节点选择,no-resolve',
        'IP-CIDR,91.108.8.0/21,🚀 节点选择,no-resolve',
        'IP-CIDR,91.108.16.0/21,🚀 节点选择,no-resolve',
        'IP-CIDR,91.108.56.0/22,🚀 节点选择,no-resolve',
        'IP-CIDR,149.154.160.0/20,🚀 节点选择,no-resolve',
        'GEOIP,CN,🎯 全球直连',
        'MATCH,🐟 漏网之鱼'
    ];
    lines.push('rules:');
    for (const r of rules) lines.push(`  - ${r}`);
    return lines.join('\n') + '\n';
}

/**
 * @param {import("@cloudflare/workers-types").Request} request
 * @param {string} validSSPath
 * @param {object} config
 * @param {boolean} hasKV
 * @returns {Response}
 */
/**
 * 前台节点与订阅页面入口 (/)
 * @param {import("@cloudflare/workers-types").Request} request
 * @param {string} validSSPath
 * @param {object} config
 * @param {boolean} hasKV
 * @returns {Response}
 */
function escHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escJsStr(val) {
    return JSON.stringify(String(val ?? '')).replace(/<\//g, '<\\/');
}

function getCookieValue(cookieHeader, name) {
    if (!cookieHeader) return null;
    const parts = cookieHeader.split(';');
    for (const part of parts) {
        const eqIdx = part.indexOf('=');
        if (eqIdx === -1) continue;
        const k = part.substring(0, eqIdx).trim();
        if (k === name) {
            try { return decodeURIComponent(part.substring(eqIdx + 1).trim()); } catch (e) { return part.substring(eqIdx + 1).trim(); }
        }
    }
    return null;
}

async function buildQxSsConfig(url, validSSPath, config) {
    const method = config.ssMethod || 'aes-256-gcm';
    const methodInfo = C_SS[method] || C_SS['aes-256-gcm'];
    const rawSecret = config.ssPsk || config.yourUUID;
    const effectivePwd = methodInfo.b3 ? await deriveSS_Psk(rawSecret, methodInfo.k) : rawSecret;
    let qxHostPort = 'www.visa.com.tw:443';
    if (Array.isArray(config.cfip) && config.cfip.length > 0) {
        const firstStatic = config.cfip.map(s => String(s).trim()).find(s => s && !s.startsWith('http://') && !s.startsWith('https://') && !s.startsWith('//'));
        if (firstStatic) {
            const cleanItem = firstStatic.split('#')[0].trim();
            if (cleanItem.startsWith('[') && cleanItem.includes(']:')) {
                qxHostPort = cleanItem;
            } else if (cleanItem.includes(':')) {
                qxHostPort = cleanItem;
            } else if (cleanItem) {
                qxHostPort = `${cleanItem}:443`;
            }
        }
    }
    return `shadowsocks=${qxHostPort},method=${method},password=${effectivePwd},obfs=wss,obfs-host=${url},obfs-uri=${validSSPath}/?ed=2560,fast-open=true,udp-relay=true,tag=Workers-SS`;
}

function getCamouflageProbePage(url, showError = false, autoOpenLogin = false, setCookie = null) {
    const showModal = showError || autoOpenLogin;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edge Cloud Status - Global Telemetry</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b1120; color: #e2e8f0; min-height: 100vh; padding: 32px 16px; }
        .wrap { max-width: 860px; margin: 0 auto; }
        .top-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; padding-bottom: 22px; border-bottom: 1px solid #1e293b; margin-bottom: 24px; }
        .brand { display: flex; align-items: center; gap: 12px; user-select: none; cursor: default; }
        .brand-dot { width: 12px; height: 12px; border-radius: 50%; background: #10b981; box-shadow: 0 0 12px #10b981; }
        .brand h1 { font-size: 1.25rem; font-weight: 700; color: #f8fafc; letter-spacing: 0.3px; }
        .badge-ok { background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); color: #34d399; padding: 6px 14px; border-radius: 999px; font-size: 0.82rem; font-weight: 600; user-select: none; cursor: pointer; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 24px; }
        .m-card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 16px; }
        .m-label { font-size: 0.78rem; color: #94a3b8; margin-bottom: 6px; }
        .m-val { font-size: 1.45rem; font-weight: 700; color: #f1f5f9; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .m-sub { font-size: 0.75rem; color: #10b981; margin-top: 4px; }
        .panel { background: #111827; border: 1px solid #1f2937; border-radius: 14px; padding: 20px; margin-bottom: 20px; }
        .panel-title { font-size: 0.92rem; font-weight: 600; color: #cbd5e1; margin-bottom: 14px; display: flex; justify-content: space-between; }
        .node-row { display: flex; justify-content: space-between; align-items: center; padding: 11px 0; border-bottom: 1px solid #1e293b; font-size: 0.88rem; }
        .node-row:last-child { border-bottom: none; }
        .region { display: flex; align-items: center; gap: 10px; color: #e2e8f0; font-weight: 500; }
        .bars { display: flex; gap: 3px; align-items: center; }
        .bar { width: 4px; height: 16px; border-radius: 2px; background: #10b981; opacity: 0.88; }
        .ping { font-family: monospace; color: #94a3b8; font-size: 0.82rem; min-width: 58px; text-align: right; }
        .foot { text-align: center; color: #475569; font-size: 0.78rem; margin-top: 28px; }
        .modal-mask { position: fixed; inset: 0; background: rgba(2, 6, 23, 0.78); backdrop-filter: blur(6px); display: ${showModal ? 'flex' : 'none'}; align-items: center; justify-content: center; z-index: 999; padding: 16px; }
        .modal-box { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 28px 24px; width: 100%; max-width: 380px; box-shadow: 0 25px 50px rgba(0,0,0,0.5); }
        .modal-box h3 { font-size: 1.1rem; color: #f8fafc; margin-bottom: 6px; }
        .modal-box p { font-size: 0.82rem; color: #94a3b8; margin-bottom: 18px; }
        .err-tip { background: rgba(239, 68, 68, 0.15); border-left: 3px solid #ef4444; color: #fca5a5; padding: 9px 12px; border-radius: 6px; font-size: 0.82rem; margin-bottom: 14px; }
        .inp { width: 100%; padding: 11px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f8fafc; font-size: 0.95rem; margin-bottom: 14px; }
        .inp:focus { outline: none; border-color: #38bdf8; }
        .btn-row { display: flex; gap: 10px; }
        .btn-sub { flex: 1; padding: 10px; background: linear-gradient(135deg, #0ea5e9, #6366f1); color: #fff; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; }
        .btn-cancel { padding: 10px 16px; background: #334155; color: #cbd5e1; border: none; border-radius: 8px; cursor: pointer; }
    </style>
</head>
<body>
    <div class="wrap">
        <div class="top-bar">
            <div class="brand" id="probe-brand">
                <span class="brand-dot"></span>
                <h1>Edge Cloud Telemetry</h1>
            </div>
            <div class="badge-ok" id="probe-trigger" title="System Status">● All Systems Operational</div>
        </div>
        <div class="metrics">
            <div class="m-card"><div class="m-label">Edge Uptime (30d)</div><div class="m-val">99.99%</div><div class="m-sub">SLA Verified</div></div>
            <div class="m-card"><div class="m-label">Global Anycast RTT</div><div class="m-val" id="m-rtt">18.4 ms</div><div class="m-sub">Optimal Routing</div></div>
            <div class="m-card"><div class="m-label">Worker Memory</div><div class="m-val" id="m-mem">14.2 MB</div><div class="m-sub">128 MB Quota</div></div>
            <div class="m-card"><div class="m-label">TLS 1.3 Handshake</div><div class="m-val">0-RTT</div><div class="m-sub">Active</div></div>
        </div>
        <div class="panel">
            <div class="panel-title"><span>Regional Edge PoPs (${escHtml(url)})</span><span>90-Day Availability</span></div>
            <div class="node-row"><span class="region">🟢 Asia Pacific — Tokyo (NRT)</span><div class="bars">${'<span class="bar"></span>'.repeat(18)}</div><span class="ping">24 ms</span></div>
            <div class="node-row"><span class="region">🟢 Asia Pacific — Hong Kong (HKG)</span><div class="bars">${'<span class="bar"></span>'.repeat(18)}</div><span class="ping">15 ms</span></div>
            <div class="node-row"><span class="region">🟢 Asia Pacific — Singapore (SIN)</span><div class="bars">${'<span class="bar"></span>'.repeat(18)}</div><span class="ping">36 ms</span></div>
            <div class="node-row"><span class="region">🟢 North America — San Jose (SJC)</span><div class="bars">${'<span class="bar"></span>'.repeat(18)}</div><span class="ping">118 ms</span></div>
            <div class="node-row"><span class="region">🟢 Europe — Frankfurt (FRA)</span><div class="bars">${'<span class="bar"></span>'.repeat(18)}</div><span class="ping">152 ms</span></div>
        </div>
        <div class="foot">Powered by Edge Telemetry Engine &bull; Updated just now</div>
    </div>

    <div class="modal-mask" id="auth-modal" onclick="if(event.target===this)closeAuth()">
        <div class="modal-box">
            <h3>Node Access Console</h3>
            <p>Enter access token to view node metrics &amp; endpoints.</p>
            ${showError ? '<div class="err-tip">Access token invalid, please try again.</div>' : ''}
            <form onsubmit="submitAuth(event)">
                <input type="password" id="auth-pwd" class="inp" placeholder="Access Token" required>
                <div class="btn-row">
                    <button type="button" class="btn-cancel" onclick="closeAuth()">Cancel</button>
                    <button type="submit" class="btn-sub">Verify</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        if (window.location.search.includes("logout=") || window.location.search.includes("password=") || window.location.search.includes("login=")) {
            const u = new URL(window.location);
            u.searchParams.delete("logout"); u.searchParams.delete("password"); u.searchParams.delete("login");
            window.history.replaceState({}, "", u.pathname + u.search);
        }
        function openAuth() {
            document.getElementById("auth-modal").style.display = "flex";
            setTimeout(() => document.getElementById("auth-pwd").focus(), 50);
        }
        function closeAuth() { document.getElementById("auth-modal").style.display = "none"; }
        function submitAuth(e) {
            e.preventDefault();
            const f = document.createElement('form'); f.method = 'POST'; f.action = window.location.pathname;
            const i = document.createElement('input'); i.type = 'hidden'; i.name = 'password'; i.value = document.getElementById("auth-pwd").value;
            f.appendChild(i); document.body.appendChild(f); f.submit();
        }
        let tapCnt = 0, tapTimer = 0;
        function handleSecretTap() {
            tapCnt++;
            clearTimeout(tapTimer);
            if (tapCnt >= 2) { tapCnt = 0; openAuth(); }
            else { tapTimer = setTimeout(() => { tapCnt = 0; }, 600); }
        }
        document.getElementById("probe-trigger").addEventListener("click", handleSecretTap);
        document.getElementById("probe-brand").addEventListener("dblclick", openAuth);
        setInterval(() => {
            const rtt = (17 + Math.random() * 3.5).toFixed(1);
            const el = document.getElementById("m-rtt");
            if (el) el.textContent = rtt + " ms";
        }, 3500);
    </script>
</body>
</html>`;
    const respHeaders = {
        'Content-Type': 'text/html;charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
    };
    if (setCookie) respHeaders['Set-Cookie'] = setCookie;
    return new Response(html, { status: 200, headers: respHeaders });
}

async function getNodesPage(request, validSSPath, config, hasKV) {
	const url = request.headers.get('Host') || new URL(request.url).host;
	const baseUrl = `https://${url}`;
	const urlObj = new URL(request.url);
	const secureFlag = urlObj.protocol === 'https:' ? '; Secure' : '';
	const wantLoginModal = urlObj.searchParams.has('login');
	if (urlObj.searchParams.get('logout') === '1') {
		return getCamouflageProbePage(url, false, false, `cf_user_pwd=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secureFlag}`);
	}
	const userToken = getCookieValue(request.headers.get('Cookie'), 'cf_user_pwd');
	if (await verifyAuthToken(userToken, 'user', config.subToken || config.adminPassword)) {
		return await getNodesPageContent(url, baseUrl, validSSPath, config, hasKV, null);
	}
	return getCamouflageProbePage(url, false, wantLoginModal);
}

/**
 * 后台管理面板页面入口 (/admin)
 * @param {import("@cloudflare/workers-types").Request} request
 * @param {string} validSSPath
 * @param {object} config
 * @param {boolean} hasKV
 * @returns {Promise<Response>}
 */
async function getAdminPage(request, validSSPath, config, hasKV) {
	const url = request.headers.get('Host') || new URL(request.url).host;
	const baseUrl = `https://${url}`;
	const urlObj = new URL(request.url);
	const secureFlag = urlObj.protocol === 'https:' ? '; Secure' : '';
	if (urlObj.searchParams.get('logout') === '1') {
		return getLoginPage(url, baseUrl, false, true, `cf_admin_pwd=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secureFlag}`);
	}
	const adminToken = getCookieValue(request.headers.get('Cookie'), 'cf_admin_pwd');
	if (await verifyAuthToken(adminToken, 'admin', config.adminPassword)) {
		return await getAdminPageContent(url, baseUrl, validSSPath, config, hasKV, null);
	}
	return getLoginPage(url, baseUrl, false, true);
}

/**
 * 获取登录页面
 * @param {string} url 
 * @param {string} baseUrl 
 * @param {boolean} showError 
 * @param {boolean} isAdmin
 * @returns {Response}
 */
function getLoginPage(url, baseUrl, showError = false, isAdmin = false, setCookie = null) {
    const title = isAdmin ? 'Workers Service - 后台管理登录' : 'Workers Service - 节点与订阅登录';
    const subtitle = isAdmin ? '请输入后台管理密码 (ADMIN) 以访问管理控制台' : '请输入访问令牌 (TOKEN) 查看节点与订阅';

	const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: ${isAdmin ? 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%)' : 'linear-gradient(135deg, #7dd3ca 0%, #a17ec4 100%)'};
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #333;
            margin: 0;
            padding: 0;
            overflow: hidden;
        }
        
        .login-container {
            background: rgba(255, 255, 255, 0.96);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
            max-width: 420px;
            width: 95%;
            text-align: center;
        }
        
        .logo {
            margin-bottom: -15px;
        }
        
        .title {
            font-size: 1.7rem;
            margin-bottom: 8px;
            color: #1e293b;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }

        .badge-admin {
            display: inline-block;
            background: #4f46e5;
            color: white;
            font-size: 0.72rem;
            padding: 2px 8px;
            border-radius: 6px;
            vertical-align: middle;
        }
        
        .subtitle {
            color: #64748b;
            margin-bottom: 26px;
            font-size: 0.92rem;
            line-height: 1.4;
        }
        
        .form-group {
            margin-bottom: 20px;
            text-align: left;
        }
        
        .form-input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            font-size: 1rem;
            transition: border-color 0.3s ease;
            background: #fff;
        }
        
        .form-input:focus {
            outline: none;
            border-color: ${isAdmin ? '#4f46e5' : '#12cd9e'};
            box-shadow: 0 0 0 3px ${isAdmin ? 'rgba(79, 70, 229, 0.15)' : 'rgba(18, 205, 158, 0.15)'};
        }
        
        .btn-login {
            width: 100%;
            padding: 12px 20px;
            background: ${isAdmin ? 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' : 'linear-gradient(135deg, #12cd9e 0%, #a881d0 100%)'};
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .btn-login:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.15);
        }
        
        .error-message {
            background: #fed7d7;
            color: #c53030;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            border-left: 4px solid #e53e3e;
            font-size: 0.9rem;
        }
        
        .footer {
            margin-top: 22px;
            color: #64748b;
            font-size: 0.85rem;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .footer a {
            color: #4f46e5;
            text-decoration: none;
        }
        
        @media (max-width: 480px) {
            .login-container {
                padding: 30px 20px;
                margin: 10px;
            }
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo"><img src="https://img.icons8.com/color/96/cloudflare.png" alt="Logo"></div>
        <h1 class="title">
            Workers Service
            ${isAdmin ? '<span class="badge-admin">Admin</span>' : ''}
        </h1>
        <p class="subtitle">${subtitle}</p>
        
        ${showError ? '<div class="error-message"><i class="fas fa-exclamation-circle"></i> 密码错误，请重试</div>' : ''}
        
        <form onsubmit="handleLogin(event)">
            <div class="form-group">
                <input 
                    type="password" 
                    id="password" 
                    name="password" 
                    class="form-input" 
                    placeholder="${isAdmin ? '请输入后台管理密码 (ADMIN)' : '请输入访问令牌 (TOKEN)'}"
                    required
                    autofocus
                >
            </div>
            <button type="submit" class="btn-login"><i class="fas fa-sign-in-alt"></i> 登录</button>
        </form>
        
        <div class="footer">
            ${isAdmin ? 
                `<div><a href="/"><i class="fas fa-arrow-left"></i> 返回前台节点与订阅</a></div>` : 
                `<div><a href="/admin"><i class="fas fa-cog"></i> 访问后台管理面板 (/admin)</a></div>`
            }
        </div>
    </div>
    
    <script>
        if (window.location.search.includes('logout=') || window.location.search.includes('password=')) {
            const cleanUrl = new URL(window.location);
            cleanUrl.searchParams.delete('logout');
            cleanUrl.searchParams.delete('password');
            window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search);
        }
        function handleLogin(event) {
            event.preventDefault();
            const f = document.createElement('form'); f.method = 'POST'; f.action = window.location.pathname;
            const i = document.createElement('input'); i.type = 'hidden'; i.name = 'password'; i.value = document.getElementById('password').value;
            f.appendChild(i); document.body.appendChild(f); f.submit();
        }
    </script>
</body>
</html>`;

	const respHeaders = {
		'Content-Type': 'text/html;charset=utf-8',
		'Cache-Control': 'no-cache, no-store, must-revalidate',
	};
	if (setCookie) respHeaders['Set-Cookie'] = setCookie;
	return new Response(html, { status: 200, headers: respHeaders });
}

/**
 * 获取前台节点与订阅页面 (访问 / 且输入 TOKEN 成功后展示)
 * @param {string} url 
 * @param {string} baseUrl 
 * @param {string} validSSPath
 * @param {object} config
 * @param {boolean} hasKV
 * @returns {Response}
 */
function formatSubconverterUrl(prefix, target, rawUrl) {
    const cleanPrefix = (prefix || '').trim();
    if (!cleanPrefix) {
        return `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}target=${target}`;
    }
    const encodedRaw = encodeURIComponent(rawUrl);
    if (cleanPrefix.includes('url=')) {
        if (cleanPrefix.endsWith('=') || cleanPrefix.endsWith('&')) {
            return `${cleanPrefix}${encodedRaw}`;
        }
        return `${cleanPrefix}&url=${encodedRaw}`;
    }
    if (cleanPrefix.includes('target=')) {
        const joinChar = cleanPrefix.includes('?') ? (cleanPrefix.endsWith('?') || cleanPrefix.endsWith('&') ? '' : '&') : '?';
        return `${cleanPrefix}${joinChar}url=${encodedRaw}`;
    }
    return `${cleanPrefix.replace(/\/+$/, '')}/sub?target=${target}&url=${encodedRaw}&insert=false`;
}

function renderNodeListAndQrWidget(nodes, clashFullUrl, singboxFullUrl, rawSubUrl) {
    const itemsHtml = nodes.map((n, idx) => {
        const badgeColor = n.protocol === 'vless' ? '#4f46e5' : (n.protocol === 'trojan' ? '#0ea5e9' : '#10b981');
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #e2e8f0;gap:8px;font-size:0.85rem;">
            <div style="display:flex;align-items:center;gap:8px;min-width:0;text-align:left;">
                <span style="background:${badgeColor};color:#fff;font-size:0.7rem;font-weight:700;padding:2px 6px;border-radius:5px;text-transform:uppercase;flex-shrink:0;">${escHtml(n.protocol)}</span>
                <span style="color:#1e293b;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(n.name)}</span>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
                <button type="button" onclick="copyNodeByIdx(${idx})" style="padding:4px 10px;border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:6px;cursor:pointer;font-size:0.78rem;font-weight:600;"><i class="fas fa-copy"></i> 复制</button>
                <button type="button" onclick="qrNodeByIdx(${idx})" style="padding:4px 10px;border:1px solid #c7d2fe;background:#eef2ff;color:#4f46e5;border-radius:6px;cursor:pointer;font-size:0.78rem;font-weight:600;"><i class="fas fa-qrcode"></i> 二维码</button>
            </div>
        </div>`;
    }).join('');

    const htmlBlock = `
        <div style="margin:6px 0 12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
            <button type="button" onclick="qrSub('singbox')" style="padding:6px 12px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;border-radius:8px;cursor:pointer;font-size:0.8rem;font-weight:600;"><i class="fas fa-qrcode"></i> Sing-box 订阅码</button>
            <button type="button" onclick="qrSub('clash')" style="padding:6px 12px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;border-radius:8px;cursor:pointer;font-size:0.8rem;font-weight:600;"><i class="fas fa-qrcode"></i> Clash 订阅码</button>
            <button type="button" onclick="qrSub('raw')" style="padding:6px 12px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;border-radius:8px;cursor:pointer;font-size:0.8rem;font-weight:600;"><i class="fas fa-qrcode"></i> 通用订阅码</button>
        </div>
        <details style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin:8px 0 12px;text-align:left;overflow:hidden;">
            <summary style="padding:11px 16px;cursor:pointer;font-weight:600;font-size:0.9rem;color:#334155;user-select:none;display:flex;justify-content:space-between;align-items:center;">
                <span><i class="fas fa-list-ul" style="color:#4f46e5;margin-right:6px;"></i>展开单节点列表与扫码导入 (共 ${nodes.length} 个节点)</span>
                <span style="font-size:0.78rem;color:#64748b;">点击展开/收起</span>
            </summary>
            <div style="max-height:280px;overflow-y:auto;border-top:1px solid #e2e8f0;background:#fff;">
                ${itemsHtml || '<div style="padding:16px;text-align:center;color:#94a3b8;font-size:0.85rem;">当前未启用任何协议节点</div>'}
            </div>
        </details>
        <div id="qr-modal-mask" onclick="if(event.target===this)closeQrModal()" style="position:fixed;inset:0;background:rgba(15,23,42,0.65);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;z-index:2000;padding:16px;">
            <div style="background:#fff;border-radius:16px;padding:22px;max-width:340px;width:100%;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.25);">
                <div id="qr-modal-title" style="font-weight:700;font-size:0.95rem;color:#1e293b;margin-bottom:12px;word-break:break-all;">二维码</div>
                <div id="qr-modal-box" style="display:flex;align-items:center;justify-content:center;min-height:210px;background:#f8fafc;border-radius:12px;padding:12px;margin-bottom:14px;"></div>
                <div style="display:flex;gap:8px;justify-content:center;">
                    <button type="button" id="qr-copy-btn" style="flex:1;padding:9px 14px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.85rem;"><i class="fas fa-copy"></i> 复制内容</button>
                    <button type="button" onclick="closeQrModal()" style="padding:9px 16px;background:#e2e8f0;color:#334155;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.85rem;">关闭</button>
                </div>
            </div>
        </div>`;

    const jsBlock = `
        const __SUB_QR_MAP__ = ${JSON.stringify({ singbox: ['Sing-box 1.14+ 订阅二维码', singboxFullUrl], clash: ['Clash 订阅二维码 (自适应 FlClash/原版)', clashFullUrl], raw: ['通用全协议订阅二维码', rawSubUrl] }).replace(/<\//g, '<\\/')};
        const __NODE_LIST__ = ${JSON.stringify(nodes.map(n => ({ name: n.name, uri: n.uri }))).replace(/<\//g, '<\\/')};
        function qrSub(k) { const v = __SUB_QR_MAP__[k]; if (v) showQrModal(v[0], v[1]); }
        function copyNodeByIdx(i) {
            const item = __NODE_LIST__[i];
            if (item) copyText(item.uri, "已复制节点: " + item.name);
        }
        function qrNodeByIdx(i) {
            const item = __NODE_LIST__[i];
            if (item) showQrModal(item.name, item.uri);
        }
        function renderQrSvg(text) {
            if (typeof qrcode === "function") {
                const qr = qrcode(0, "M");
                qr.addData(text);
                qr.make();
                return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
            }
            return null;
        }
        function showQrModal(title, text) {
            const mask = document.getElementById("qr-modal-mask");
            const titleEl = document.getElementById("qr-modal-title");
            const box = document.getElementById("qr-modal-box");
            const copyBtn = document.getElementById("qr-copy-btn");
            titleEl.textContent = title;
            copyBtn.onclick = function() { copyText(text, "内容已复制到剪贴板!"); };
            mask.style.display = "flex";
            const svg = renderQrSvg(text);
            if (svg) {
                box.innerHTML = svg;
                const svgEl = box.querySelector("svg");
                if (svgEl) { svgEl.style.width = "200px"; svgEl.style.height = "200px"; }
            } else {
                box.innerHTML = '<span style="color:#64748b;font-size:0.85rem;">正在加载本地二维码引擎...</span>';
                const s = document.createElement("script");
                s.src = "https://unpkg.com/qrcode-generator@1.4.4/qrcode.js";
                s.onload = function() {
                    const retrySvg = renderQrSvg(text);
                    if (retrySvg) {
                        box.innerHTML = retrySvg;
                        const svgEl = box.querySelector("svg");
                        if (svgEl) { svgEl.style.width = "200px"; svgEl.style.height = "200px"; }
                    }
                };
                s.onerror = function() { box.innerHTML = '<span style="color:#ef4444;font-size:0.82rem;">离线环境无法渲染图形，请点击下方复制按钮</span>'; };
                document.head.appendChild(s);
            }
        }
        function closeQrModal() { document.getElementById("qr-modal-mask").style.display = "none"; }`;

    return { htmlBlock, jsBlock };
}

async function getNodesPageContent(url, baseUrl, validSSPath, config, hasKV, setCookie = null) {
    const rawSubUrl = `${baseUrl}/${subPathWithToken(config)}`;
    const clashFullUrl = formatSubconverterUrl(config.clashSubUrl, 'clash', rawSubUrl);
    const singboxFullUrl = formatSubconverterUrl(config.singboxSubUrl, 'singbox', rawSubUrl);
    const qxFullConfig = await buildQxSsConfig(url, validSSPath, config);
    const currentDomain = url.split(':')[0];
    const previewNodes = await buildAllNodes(config, currentDomain, validSSPath);
    const qrWidget = renderNodeListAndQrWidget(previewNodes, clashFullUrl, singboxFullUrl, rawSubUrl);

	const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Workers Service - 节点与订阅</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #66ead7 0%, #9461c8 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #333;
            margin: 0;
            padding: 15px 0;
        }
        
        .container {
            background: rgba(255, 255, 255, 0.96);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 24px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.12);
            max-width: 820px;
            width: 95%;
            max-height: 90vh;
            text-align: center;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            position: relative;
        }
        
        .logout-btn {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #a7a0d8;
            color: #b91c1c;
            border: none;
            border-radius: 8px;
            padding: 8px 16px;
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            z-index: 1000;
        }
        
        .logout-btn:hover {
            background: #e2e8f0;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        
        .logo {
            margin-bottom: -10px;
        }
        
        .title {
            font-size: 1.8rem;
            margin-bottom: 6px;
            color: #2d3748;
        }
        
        .subtitle {
            color: #718096;
            margin-bottom: 16px;
            font-size: 0.95rem;
        }

        .info-card {
            background: #f8fafc;
            border-radius: 12px;
            padding: 16px;
            margin: 10px 0;
            border-left: 4px solid #6ed8c9;
            text-align: left;
        }
        
        .info-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid #e2e8f0;
            font-size: 0.9rem;
        }
        
        .info-item:last-child {
            border-bottom: none;
        }
        
        .label {
            font-weight: 600;
            color: #4a5568;
            flex-shrink: 0;
        }
        
        .value {
            color: rgb(20, 23, 29);
            font-family: 'Courier New', monospace;
            background: #edf2f7;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 0.82rem;
            word-break: break-all;
            margin-left: 12px;
            text-align: right;
        }
        
        .button-group {
            display: flex;
            gap: 10px;
            justify-content: center;
            flex-wrap: wrap;
            margin: 16px 0;
        }
        
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.3s ease;
        }
        
        .btn-secondary {
            background: linear-gradient(45deg, #68e3d6, #906cc9);
            color: #001379;
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
        }
        
        .status {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #48bb78;
            margin-right: 6px;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        
        .footer {
            margin-top: 15px;
            color: #718096;
            font-size: 0.9rem;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
        }
        
        .footer-links {
            display: flex;
            align-items: center;
            gap: 15px;
            flex-wrap: wrap;
            justify-content: center;
        }
        
        .footer-link {
            color: #667eea;
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 500;
            transition: all 0.3s ease;
            padding: 4px 8px;
            border-radius: 6px;
        }
        
        .footer-link:hover {
            background: rgba(102, 126, 234, 0.1);
            transform: translateY(-1px);
        }

        .admin-link {
            color: #4f46e5;
            background: #eef2ff;
            border: 1px solid #c7d2fe;
            padding: 6px 14px;
            border-radius: 20px;
            font-weight: 600;
            font-size: 0.85rem;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-top: 6px;
            transition: all 0.2s ease;
        }

        .admin-link:hover {
            background: #e0e7ff;
            transform: translateY(-1px);
        }
        
        .github-icon {
            width: 16px;
            height: 16px;
            fill: currentColor;
        }
        
        .toast {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ffffff;
            border-left: 4px solid #10b981;
            border-radius: 8px;
            padding: 12px 18px;
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 1100;
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s ease;
            max-width: 320px;
        }
        
        .toast.show {
            opacity: 1;
            transform: translateX(0);
        }
        
        .toast-icon {
            width: 22px;
            height: 22px;
            background: #10b981;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 12px;
            font-weight: bold;
            flex-shrink: 0;
        }
        
        .toast-message {
            color: #1e293b;
            font-size: 14px;
            font-weight: 500;
            text-align: left;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 16px;
                margin: 8px;
                max-height: 94vh;
            }
            
            .info-item {
                flex-direction: column;
                align-items: flex-start;
                gap: 4px;
            }
            
            .value {
                margin-left: 0;
                text-align: left;
                width: 100%;
            }
        }
    </style>
</head>
<body>
    <button onclick="logout()" class="logout-btn">
        <i class="fas fa-sign-out-alt"></i>
        <span>退出</span>
    </button>
    
    <div class="container">
        <div class="logo"><img src="https://img.icons8.com/color/96/cloudflare.png" alt="Logo"></div>
        <h1 class="title">Workers Service</h1>
        <p class="subtitle">基于 Cloudflare Workers 的高性能网络服务 (VLESS + Trojan + Shadowsocks)</p>

        <div class="info-card">
            <div class="info-item">
                <span class="label">服务状态</span>
                <span class="value"><span class="status"></span>运行中</span>
            </div>
            <div class="info-item">
                <span class="label">主机地址</span>
                <span class="value">${url}</span>
            </div>
            <div class="info-item">
                <span class="label">UUID</span>
                <span class="value">${config.yourUUID}</span>
            </div>
            <div class="info-item">
                <span class="label">SS 节点路径</span>
                <span class="value">${validSSPath}/?ed=2560</span>
            </div>
            <div class="info-item">
                <span class="label">全协议订阅地址</span>
                <span class="value">${baseUrl}/${subPathWithToken(config)}</span>
            </div>
            <div class="info-item">
                <span class="label">Clash 订阅地址</span>
                <span class="value">${clashFullUrl}</span>
            </div>
            <div class="info-item">
                <span class="label">Sing-box 订阅地址</span>
                <span class="value">${singboxFullUrl}</span>
            </div>
        </div>
        
        <div class="button-group">
            <button onclick="copySingboxSubscription()" class="btn btn-secondary">
                <i class="fas fa-cube"></i> 复制 Sing-box 订阅
            </button>
            <button onclick="copyClashSubscription()" class="btn btn-secondary">
                <i class="fas fa-cat"></i> 复制 Clash 订阅
            </button>
            <button onclick="copySubscription()" class="btn btn-secondary">
                <i class="fas fa-link"></i> 复制全部节点订阅
            </button>
            <button onclick="copyQXConfig()" class="btn btn-secondary">
                <i class="fas fa-paper-plane"></i> 复制 Quantumult X 配置
            </button>
        </div>
        ${qrWidget.htmlBlock}
        <div class="footer">
            <div>
                <a href="/admin" class="admin-link">
                    <i class="fas fa-user-shield"></i> 进入后台管理面板 (/admin)
                </a>
            </div>
            <div class="footer-links">
                <a href="https://github.com/zaofengyue/CF-Workers-VLESS" target="_blank" class="footer-link">
                    <svg class="github-icon" viewBox="0 0 24 24">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.479-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                    <span>GitHub 项目</span>
                </a>
                <a href="https://proxy.fengyue.bond" target="_blank" class="footer-link">
                    <span>✅</span>
                    <span>Proxyip 检测服务</span>
                </a>
                <a href="https://socks.fengyue.bond" target="_blank" class="footer-link">
                    <span>🧦</span>
                    <span>socks5 检测服务</span>
                </a>
            </div>
        </div>
    </div>
    
    <script>
        function showToast(message) {
            const existingToast = document.querySelector('.toast');
            if (existingToast) existingToast.remove();
            
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.innerHTML = '<div class="toast-icon">✓</div><div class="toast-message">' + message + '</div>';
            document.body.appendChild(toast);
            
            setTimeout(() => { toast.classList.add('show'); }, 10);
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
            }, 1800);
        }

        function copySubscription() {
            const configUrl = ${escJsStr(`${baseUrl}/${subPathWithToken(config)}`)};
            copyText(configUrl, '全协议订阅链接已复制到剪贴板!');
        }
        
        function copyClashSubscription() {
            const clashUrl = ${escJsStr(clashFullUrl)};
            copyText(clashUrl, 'Clash 订阅链接已复制到剪贴板!');
        }
        
        function copySingboxSubscription() {
            const singboxUrl = ${escJsStr(singboxFullUrl)};
            copyText(singboxUrl, 'Sing-box 订阅链接已复制到剪贴板!');
        }
        
        function copyQXConfig() {
            const qx = ${escJsStr(qxFullConfig)};
            copyText(qx, 'Quantumult X 配置已复制!');
        }

        function copyText(text, msg) {
            navigator.clipboard.writeText(text).then(() => {
                showToast(msg);
            }).catch(() => {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                showToast(msg);
            });
        }
        
        if (window.location.search.includes('password=')) {
            const cleanUrl = new URL(window.location);
            cleanUrl.searchParams.delete('password');
            window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search);
        }
        function logout() {
            if (confirm('确定要退出登录吗?')) {
                window.location.href = '/?logout=1';
            }
        }
        ${qrWidget.jsBlock}
    </script>
</body>
</html>`;

	const respHeaders = {
		'Content-Type': 'text/html;charset=utf-8',
		'Cache-Control': 'no-cache, no-store, must-revalidate',
	};
	if (setCookie) respHeaders['Set-Cookie'] = setCookie;
	return new Response(html, { status: 200, headers: respHeaders });
}

/**
 * 获取后台管理面板页面 (访问 /admin 且输入 ADMIN 密码成功后展示)
 * @param {string} url 
 * @param {string} baseUrl 
 * @param {string} validSSPath
 * @param {object} config
 * @param {boolean} hasKV
 * @returns {Response}
 */
async function getAdminPageContent(url, baseUrl, validSSPath, config, hasKV, setCookie = null) {
    const rawSubUrl = `${baseUrl}/${subPathWithToken(config)}`;
    const clashFullUrl = formatSubconverterUrl(config.clashSubUrl, 'clash', rawSubUrl);
    const singboxFullUrl = formatSubconverterUrl(config.singboxSubUrl, 'singbox', rawSubUrl);
    const qxFullConfig = await buildQxSsConfig(url, validSSPath, config);
    const currentDomain = url.split(':')[0];
    const previewNodes = await buildAllNodes(config, currentDomain, validSSPath);
    const qrWidget = renderNodeListAndQrWidget(previewNodes, clashFullUrl, singboxFullUrl, rawSubUrl);

	const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Workers Service - 后台管理控制台</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #1e293b;
            margin: 0;
            padding: 15px 0;
        }
        
        .container {
            background: rgba(255, 255, 255, 0.98);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 24px;
            box-shadow: 0 20px 45px rgba(0, 0, 0, 0.3);
            max-width: 860px;
            width: 95%;
            max-height: 92vh;
            text-align: center;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            position: relative;
        }
        
        .logout-btn {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fee2e2;
            color: #b91c1c;
            border: 1px solid #fca5a5;
            border-radius: 8px;
            padding: 8px 16px;
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 6px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            z-index: 1000;
        }
        
        .logout-btn:hover {
            background: #fecaca;
            transform: translateY(-1px);
        }
        
        .logo {
            margin-bottom: -10px;
        }
        
        .title {
            font-size: 1.8rem;
            margin-bottom: 6px;
            color: #1e293b;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }

        .badge-admin {
            background: #4f46e5;
            color: white;
            font-size: 0.75rem;
            padding: 3px 10px;
            border-radius: 6px;
            font-weight: 600;
        }
        
        .subtitle {
            color: #64748b;
            margin-bottom: 16px;
            font-size: 0.95rem;
        }

        /* 标签页切换导航 */
        .nav-tabs {
            display: flex;
            gap: 12px;
            justify-content: center;
            margin-bottom: 16px;
            border-bottom: 2px solid #e2e8f0;
            padding-bottom: 10px;
        }

        .nav-tab {
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            font-size: 0.95rem;
            font-weight: 600;
            color: #64748b;
            padding: 9px 20px;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.25s ease;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .nav-tab:hover {
            background: #e2e8f0;
            color: #334155;
        }

        .nav-tab.active {
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            color: white;
            border-color: transparent;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
        }

        .tab-content {
            display: none;
            animation: fadeIn 0.3s ease;
        }

        .tab-content.active {
            display: block;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(4px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* KV 状态条 */
        .badge-kv {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 12px 16px;
            border-radius: 10px;
            font-size: 0.85rem;
            margin-bottom: 18px;
            text-align: left;
            line-height: 1.5;
        }

        .badge-kv.connected {
            background: #ecfdf5;
            color: #065f46;
            border: 1px solid #6ee7b7;
        }

        .badge-kv.disconnected {
            background: #fffbeb;
            color: #92400e;
            border: 1px solid #fcd34d;
        }

        .badge-kv i {
            font-size: 1.1rem;
            margin-top: 2px;
        }

        .config-card {
            background: #f8fafc;
            border-radius: 12px;
            padding: 18px;
            margin-bottom: 16px;
            text-align: left;
            border: 1px solid #e2e8f0;
        }

        .config-card h3 {
            font-size: 1.05rem;
            color: #1e293b;
            margin-bottom: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
            border-bottom: 1px dashed #cbd5e1;
            padding-bottom: 8px;
        }

        .form-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 14px;
        }

        .form-group {
            display: flex;
            flex-direction: column;
            margin-bottom: 12px;
        }

        .form-group label {
            font-weight: 600;
            font-size: 0.85rem;
            color: #334155;
            margin-bottom: 6px;
        }

        .form-input, .form-textarea {
            width: 100%;
            padding: 9px 12px;
            border: 1.5px solid #cbd5e1;
            border-radius: 8px;
            font-size: 0.9rem;
            background: white;
            color: #1e293b;
            transition: all 0.2s ease;
        }

        .form-input:focus, .form-textarea:focus {
            outline: none;
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }

        .form-textarea {
            font-family: 'Courier New', monospace;
            font-size: 0.85rem;
            line-height: 1.5;
            resize: vertical;
        }

        .form-hint {
            font-size: 0.75rem;
            color: #64748b;
            margin-top: 4px;
        }

        .switch-group {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid #e2e8f0;
        }

        .switch-group:last-child {
            border-bottom: none;
        }

        .switch-info {
            display: flex;
            flex-direction: column;
        }

        .switch-title {
            font-size: 0.9rem;
            font-weight: 600;
            color: #1e293b;
        }

        .switch-desc {
            font-size: 0.75rem;
            color: #64748b;
        }

        .switch {
            position: relative;
            display: inline-block;
            width: 46px;
            height: 24px;
            flex-shrink: 0;
        }

        .switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }

        .slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: #cbd5e1;
            transition: .3s;
            border-radius: 24px;
        }

        .slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: .3s;
            border-radius: 50%;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }

        input:checked + .slider {
            background-color: #10b981;
        }

        input:checked + .slider:before {
            transform: translateX(22px);
        }

        .button-group {
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
            margin: 16px 0;
        }
        
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.3s ease;
        }
        
        .btn-primary {
            background: linear-gradient(45deg, #4f46e5, #7c3aed);
            color: white;
        }
        
        .btn-secondary {
            background: #e2e8f0;
            color: #1e293b;
        }

        .btn-danger {
            background: linear-gradient(45deg, #ef4444, #dc2626);
            color: white;
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
        }

        .info-card {
            background: #f8fafc;
            border-radius: 12px;
            padding: 16px;
            margin: 10px 0;
            border-left: 4px solid #6366f1;
            text-align: left;
        }
        
        .info-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid #e2e8f0;
            font-size: 0.9rem;
        }
        
        .info-item:last-child {
            border-bottom: none;
        }
        
        .label {
            font-weight: 600;
            color: #4a5568;
            flex-shrink: 0;
        }
        
        .value {
            color: rgb(20, 23, 29);
            font-family: 'Courier New', monospace;
            background: #edf2f7;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 0.82rem;
            word-break: break-all;
            margin-left: 12px;
            text-align: right;
        }

        .status {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #48bb78;
            margin-right: 6px;
        }
        
        .footer {
            margin-top: 15px;
            color: #718096;
            font-size: 0.9rem;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
        }
        
        .footer-links {
            display: flex;
            align-items: center;
            gap: 15px;
            flex-wrap: wrap;
            justify-content: center;
        }
        
        .footer-link {
            color: #6366f1;
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 500;
            transition: all 0.3s ease;
            padding: 4px 8px;
            border-radius: 6px;
        }
        
        .footer-link:hover {
            background: rgba(99, 102, 241, 0.1);
        }

        .toast {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ffffff;
            border-left: 4px solid #10b981;
            border-radius: 8px;
            padding: 12px 18px;
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 1100;
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s ease;
            max-width: 320px;
        }
        
        .toast.show {
            opacity: 1;
            transform: translateX(0);
        }
        
        .toast-icon {
            width: 22px;
            height: 22px;
            background: #10b981;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 12px;
            font-weight: bold;
            flex-shrink: 0;
        }
        
        .toast-message {
            color: #1e293b;
            font-size: 14px;
            font-weight: 500;
            text-align: left;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 16px;
                margin: 8px;
                max-height: 94vh;
            }
            
            .info-item {
                flex-direction: column;
                align-items: flex-start;
                gap: 4px;
            }
            
            .value {
                margin-left: 0;
                text-align: left;
                width: 100%;
            }
            
            .form-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <button onclick="logout()" class="logout-btn">
        <i class="fas fa-sign-out-alt"></i>
        <span>退出管理</span>
    </button>
    
    <div class="container">
        <div class="logo"><img src="https://img.icons8.com/color/96/cloudflare.png" alt="Logo"></div>
        <h1 class="title">
            Workers Service
            <span class="badge-admin">Admin 控制台</span>
        </h1>
        <p class="subtitle">Cloudflare Workers 后台管理面板与全局 KV 配置中心</p>

        <!-- 标签页导航 -->
        <div class="nav-tabs">
            <button type="button" class="nav-tab active" id="tab-btn-admin" onclick="switchTab('admin')">
                <i class="fas fa-sliders-h"></i> 后台配置中心
            </button>
            <button type="button" class="nav-tab" id="tab-btn-nodes" onclick="switchTab('nodes')">
                <i class="fas fa-network-wired"></i> 节点与订阅预览
            </button>
        </div>

        <!-- Tab 1: 后台管理配置 -->
        <div id="tab-admin" class="tab-content active">
            ${hasKV ? `
            <div class="badge-kv connected">
                <i class="fas fa-check-circle"></i>
                <div>
                    <b>Cloudflare KV 命名空间已成功连接！</b><br>
                    在此面板修改并保存后，配置将自动持久化保存在 KV 中，所有节点与订阅即时生效，无需重新部署 Worker。
                </div>
            </div>
            ` : `
            <div class="badge-kv disconnected">
                <i class="fas fa-exclamation-triangle"></i>
                <div>
                    <b>未检测到名为 KV 的命名空间绑定！</b> 当前显示的为环境变量或代码默认值。<br>
                    <b>如需在后台持久化保存配置：</b><br>
                    1. 访问 Cloudflare Dashboard &rarr; <b>Workers & Pages</b> &rarr; <b>KV</b> 创建一个命名空间（如 <code>CF_VLESS_KV</code>）；<br>
                    2. 进入该 Worker 的 <b>Settings</b> &rarr; <b>Variables and Secrets</b> &rarr; <b>KV Namespace Bindings</b>；<br>
                    3. 添加变量名称为 <b><code>KV</code></b> 的绑定，目标选择刚创建的命名空间，点击 Deploy 即可。
                </div>
            </div>
            `}

            <!-- 基础设置 -->
            <div class="config-card">
                <h3><i class="fas fa-key"></i> 认证与密码设置</h3>
                <div class="form-grid">
                    <div class="form-group">
                        <label for="cfg-admin-password">后台管理密码 (ADMIN)</label>
                        <input type="text" id="cfg-admin-password" class="form-input" value="${escHtml(config.adminPassword)}" placeholder="后台管理密码">
                        <span class="form-hint">进入此 /admin 后台管理面板的密码</span>
                    </div>
                    <div class="form-group">
                        <label for="cfg-subtoken">访问令牌 (TOKEN)</label>
                        <input type="text" id="cfg-subtoken" class="form-input" value="${escHtml(config.subToken || '')}" placeholder="留空则订阅不校验，前台使用 ADMIN 登录">
                        <span class="form-hint">订阅需带 ?token=，同时作为首页查看节点的登录凭据</span>
                    </div>
                    <div class="form-group">
                        <label for="cfg-uuid">用户 UUID</label>
                        <input type="text" id="cfg-uuid" class="form-input" value="${escHtml(config.yourUUID)}" placeholder="客户端连接使用的 UUID">
                        <span class="form-hint">VLESS / Trojan / Shadowsocks 鉴权 UUID</span>
                    </div>
                    <div class="form-group">
                        <label for="cfg-subpath">节点订阅路径 (SUB_PATH)</label>
                        <input type="text" id="cfg-subpath" class="form-input" value="${escHtml(config.subPath)}" placeholder="默认 sub">
                        <span class="form-hint">客户端订阅获取路径 /${escHtml(config.subPath)}</span>
                    </div>
                    <div class="form-group">
                        <label for="cfg-sspath">Shadowsocks 验证路径 (SSPATH)</label>
                        <input type="text" id="cfg-sspath" class="form-input" value="${escHtml(config.SSpath)}" placeholder="默认 fengyue">
                        <span class="form-hint">SS 节点 WebSocket 路径鉴权，默认 fengyue</span>
                    </div>
                    <div class="form-group">
                        <label for="cfg-ssmethod">Shadowsocks 加密算法 (SS_METHOD)</label>
                        <select id="cfg-ssmethod" class="form-input">
                            <option value="aes-256-gcm" ${config.ssMethod === 'aes-256-gcm' ? 'selected' : ''}>aes-256-gcm (推荐，硬件加速)</option>
                            <option value="aes-128-gcm" ${config.ssMethod === 'aes-128-gcm' ? 'selected' : ''}>aes-128-gcm (硬件加速)</option>
                            <option value="chacha20-ietf-poly1305" ${config.ssMethod === 'chacha20-ietf-poly1305' ? 'selected' : ''}>chacha20-ietf-poly1305 (经典 AEAD)</option>
                            <option value="xchacha20-ietf-poly1305" ${config.ssMethod === 'xchacha20-ietf-poly1305' ? 'selected' : ''}>xchacha20-ietf-poly1305</option>
                            <option value="2022-blake3-aes-256-gcm" ${config.ssMethod === '2022-blake3-aes-256-gcm' ? 'selected' : ''}>2022-blake3-aes-256-gcm (SS 2022)</option>
                            <option value="2022-blake3-aes-128-gcm" ${config.ssMethod === '2022-blake3-aes-128-gcm' ? 'selected' : ''}>2022-blake3-aes-128-gcm (SS 2022)</option>
                            <option value="2022-blake3-chacha20-poly1305" ${config.ssMethod === '2022-blake3-chacha20-poly1305' ? 'selected' : ''}>2022-blake3-chacha20-poly1305</option>
                            <option value="none" ${config.ssMethod === 'none' ? 'selected' : ''}>none (明文直通，零 CPU 开销)</option>
                            <option value="plain" ${config.ssMethod === 'plain' ? 'selected' : ''}>plain</option>
                            <option value="chacha20-ietf" ${config.ssMethod === 'chacha20-ietf' ? 'selected' : ''}>chacha20-ietf (经典流密码)</option>
                            <option value="xchacha20" ${config.ssMethod === 'xchacha20' ? 'selected' : ''}>xchacha20</option>
                            <option value="aes-256-ctr" ${config.ssMethod === 'aes-256-ctr' ? 'selected' : ''}>aes-256-ctr</option>
                            <option value="aes-128-ctr" ${config.ssMethod === 'aes-128-ctr' ? 'selected' : ''}>aes-128-ctr</option>
                            <option value="aes-256-cfb" ${config.ssMethod === 'aes-256-cfb' ? 'selected' : ''}>aes-256-cfb</option>
                            <option value="aes-128-cfb" ${config.ssMethod === 'aes-128-cfb' ? 'selected' : ''}>aes-128-cfb</option>
                            <option value="rc4-md5" ${config.ssMethod === 'rc4-md5' ? 'selected' : ''}>rc4-md5</option>
                        </select>
                        <span class="form-hint">选择 SS 加密算法，支持 18 种算法全特性</span>
                    </div>
                    <div class="form-group">
                        <label for="cfg-sspsk">Shadowsocks 2022 预共享密钥 (SS_PSK)</label>
                        <input type="text" id="cfg-sspsk" class="form-input" value="${escHtml(config.ssPsk || '')}" placeholder="留空则由 UUID 自动派生">
                        <span class="form-hint">留空时由 UUID 自动派生（同一 UUID 结果固定）</span>
                    </div>
                </div>
            </div>

            <!-- 协议开关 -->
            <div class="config-card">
                <h3><i class="fas fa-toggle-on"></i> 协议启用开关</h3>
                <div class="switch-group">
                    <div class="switch-info">
                        <span class="switch-title">VLESS 协议</span>
                        <span class="switch-desc">是否开启 VLESS (WS) 协议节点支持</span>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="cfg-vless" ${config.disablevless ? '' : 'checked'}>
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="switch-group">
                    <div class="switch-info">
                        <span class="switch-title">Trojan 协议</span>
                        <span class="switch-desc">是否开启 Trojan (WS) 协议节点支持</span>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="cfg-trojan" ${config.disabletro ? '' : 'checked'}>
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="switch-group">
                    <div class="switch-info">
                        <span class="switch-title">Shadowsocks 协议</span>
                        <span class="switch-desc">是否开启 Shadowsocks (v2ray-plugin WS) 节点支持</span>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="cfg-ss" ${config.disabless ? '' : 'checked'}>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>

            <!-- 全局落地代理设置 (优先级最高) -->
            <div class="config-card">
                <h3><i class="fas fa-network-wired"></i> 全局落地代理设置 (SOCKS5 / HTTP(S) / SSTP / TURN) <span style="font-size: 0.75rem; background: #10b981; color: white; padding: 2px 8px; border-radius: 12px; margin-left: 8px;">最高优先级</span></h3>
                <div class="form-group">
                    <label for="cfg-landing-proxy">落地代理列表 (每行一个，支持 #备注名；一旦配置强制走落地代理，反代自动挂起失效)</label>
                    <textarea id="cfg-landing-proxy" class="form-textarea" rows="4" placeholder="支持每行一个，支持 #备注名，例如：&#10;socks5://user:pass@1.2.3.4:1080#香港S5&#10;http://user:pass@5.6.7.8:8080#日本HTTP&#10;https://user:pass@domain:443#新加坡HTTPS(需有效域名证书)&#10;sstp://vpn:vpn@domain:443#美国SSTP&#10;turn://user:pass@domain:3478#德国TURN">${escHtml(Array.isArray(config.landingProxies) && config.landingProxies.length > 0 ? config.landingProxies.join('\n') : (config.landingProxy || ''))}</textarea>
                    <span class="form-hint">支持协议：<code>socks5://user:pass@host:port#备注</code>、<code>http://...</code>、<code>https://user:pass@domain:port#备注</code>（需有效域名证书且勿开CF小黄云）、<code>sstp://...</code>、<code>turn://...</code><br><strong>优先级最高</strong>：一旦填写了全局落地代理，所有出站流量均强制走落地代理；与下方反代互斥，仅会生效其中一个。</span>
                </div>
            </div>

            <!-- 反代 / ProxyIP 设置 (仅当未配置全局落地代理时生效) -->
            <div class="config-card">
                <h3><i class="fas fa-server"></i> 分流反代设置 (Proxy IP) <span style="font-size: 0.75rem; background: #64748b; color: white; padding: 2px 8px; border-radius: 12px; margin-left: 8px;">备用出站</span></h3>
                <div class="form-group">
                    <label for="cfg-proxyip">反代列表 (仅当未配置上述全局落地代理时生效，支持 #备注名)</label>
                    <textarea id="cfg-proxyip" class="form-textarea" rows="3" placeholder="支持每行一个，支持 #备注名，例如：&#10;ProxyIP.CMLiussss.net#默认反代&#10;1.2.3.4:443#香港反代">${escHtml(Array.isArray(config.proxyIPs) && config.proxyIPs.length > 0 ? config.proxyIPs.join('\n') : (config.proxyIP || ''))}</textarea>
                    <span class="form-hint">支持：<code>IP:端口#备注</code>、<code>域名:端口#备注</code>。<strong>仅在未配置全局落地代理时生效</strong>。用于 CDN 回源反代。</span>
                </div>
            </div>

            <!-- 优选节点列表 -->
            <div class="config-card">
                <h3><i class="fas fa-bolt"></i> 优选 CDN 域名、IP 列表或远程订阅链接 (每行一个)</h3>
                <div class="form-group">
                    <textarea id="cfg-cfip" class="form-textarea" rows="7" placeholder="默认为空（未填写时自动使用 www.visa.com.tw 优选）。&#10;如需自定义，格式支持:&#10;优选域名:端口#名称&#10;优选IP:端口#名称&#10;[IPv6]:端口#名称&#10;https://... (远程文本订阅链接)">${escHtml((Array.isArray(config.cfip) && !(config.cfip.length === 1 && config.cfip[0] === 'www.visa.com.tw')) ? config.cfip.join('\n') : '')}</textarea>
                    <span class="form-hint">默认为空，出站自动使用 <code>www.visa.com.tw</code>。若填写了自定义优选节点，则优先使用填写的节点。支持 <code>域名:端口#名称</code>、<code>IP:端口#名称</code>，或 <code>https://...</code> 远程订阅链接。</span>
                </div>
            </div>

            <!-- 订阅转换后端设置 -->
            <div class="config-card">
                <h3><i class="fas fa-sync-alt"></i> 订阅转换引擎设置 <span style="font-size: 0.75rem; background: #4f46e5; color: white; padding: 2px 8px; border-radius: 12px; margin-left: 8px;">默认内置原生直出</span></h3>
                <div class="form-grid">
                    <div class="form-group">
                        <label for="cfg-clash-sub">外部 Clash 转换前缀 (留空使用内置双模引擎)</label>
                        <input type="text" id="cfg-clash-sub" class="form-input" value="${escHtml(config.clashSubUrl)}" placeholder="推荐留空：自动识别 FlClash(Mihomo) 与原版 Clash">
                        <span class="form-hint">留空走 Worker 原生直出（自动兼容 FlClash 全协议与原版 Clash）；填写则走外部 subconverter</span>
                    </div>
                    <div class="form-group">
                        <label for="cfg-singbox-sub">外部 Sing-box 转换前缀 (留空使用内置 1.14+ 引擎)</label>
                        <input type="text" id="cfg-singbox-sub" class="form-input" value="${escHtml(config.singboxSubUrl)}" placeholder="推荐留空：原生适配最新 Sing-box 1.14+ 规范">
                        <span class="form-hint">留空走 Worker 原生直出（适配 Sing-box 1.14+ 最新语法）；填写则走外部 subconverter</span>
                    </div>
                </div>
            </div>

            <!-- 操作按钮 -->
            <div class="button-group">
                <button type="button" onclick="saveAdminConfig()" class="btn btn-primary" style="padding: 12px 28px; font-size: 1rem;">
                    <i class="fas fa-save"></i> 保存并立即生效
                </button>
                <button type="button" onclick="resetAdminConfig()" class="btn btn-danger" style="padding: 12px 20px;">
                    <i class="fas fa-undo"></i> 恢复默认配置
                </button>
            </div>
        </div>

        <!-- Tab 2: 节点与订阅预览 -->
        <div id="tab-nodes" class="tab-content">
            <div class="info-card">
                <div class="info-item">
                    <span class="label">服务状态</span>
                    <span class="value"><span class="status"></span>运行中</span>
                </div>
                <div class="info-item">
                    <span class="label">主机地址</span>
                    <span class="value">${url}</span>
                </div>
                <div class="info-item">
                    <span class="label">UUID</span>
                    <span class="value">${config.yourUUID}</span>
                </div>
                <div class="info-item">
                    <span class="label">SS 节点路径</span>
                    <span class="value">${validSSPath}/?ed=2560</span>
                </div>
                <div class="info-item">
                    <span class="label">全协议订阅地址</span>
                    <span class="value">${baseUrl}/${subPathWithToken(config)}</span>
                </div>
                <div class="info-item">
                    <span class="label">Clash 订阅地址</span>
                    <span class="value">${clashFullUrl}</span>
                </div>
                <div class="info-item">
                    <span class="label">Sing-box 订阅地址</span>
                    <span class="value">${singboxFullUrl}</span>
                </div>
            </div>
            
            <div class="button-group">
                <button onclick="copySingboxSubscription()" class="btn btn-secondary">
                    <i class="fas fa-cube"></i> 复制 Sing-box 订阅
                </button>
                <button onclick="copyClashSubscription()" class="btn btn-secondary">
                    <i class="fas fa-cat"></i> 复制 Clash 订阅
                </button>
                <button onclick="copySubscription()" class="btn btn-secondary">
                    <i class="fas fa-link"></i> 复制全部节点订阅
                </button>
                <button onclick="copyQXConfig()" class="btn btn-secondary">
                    <i class="fas fa-paper-plane"></i> 复制 Quantumult X 配置
                </button>
            </div>
            ${qrWidget.htmlBlock}
        </div>
        
        <div class="footer">
            <div class="footer-links">
                <a href="/" class="footer-link">
                    <i class="fas fa-external-link-alt"></i>
                    <span>返回前台用户页面</span>
                </a>
                <a href="https://github.com/zaofengyue/CF-Workers-VLESS" target="_blank" class="footer-link">
                    <i class="fab fa-github"></i>
                    <span>GitHub 项目</span>
                </a>
                <a href="https://proxy.fengyue.bond" target="_blank" class="footer-link">
                    <span>✅</span>
                    <span>Proxyip 检测服务</span>
                </a>
                <a href="https://socks.fengyue.bond" target="_blank" class="footer-link">
                    <span>🧦</span>
                    <span>socks5 检测服务</span>
                </a>
            </div>
        </div>
    </div>
    
    <script>
        let currentAdminPassword = '';

        function switchTab(tabName) {
            document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            if (tabName === 'nodes') {
                document.getElementById('tab-btn-nodes').classList.add('active');
                document.getElementById('tab-nodes').classList.add('active');
            } else {
                document.getElementById('tab-btn-admin').classList.add('active');
                document.getElementById('tab-admin').classList.add('active');
            }
        }

        function showToast(message) {
            const existingToast = document.querySelector('.toast');
            if (existingToast) existingToast.remove();
            
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.innerHTML = '<div class="toast-icon">✓</div><div class="toast-message">' + message + '</div>';
            document.body.appendChild(toast);
            
            setTimeout(() => { toast.classList.add('show'); }, 10);
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
            }, 1800);
        }

        async function saveAdminConfig() {
            const cfipRaw = document.getElementById('cfg-cfip').value;
            const cfipList = cfipRaw.split('\\n').map(s => s.trim()).filter(Boolean);
            const landingRaw = document.getElementById('cfg-landing-proxy').value;
            const landingList = landingRaw.split('\\n').map(s => s.trim()).filter(Boolean);
            const proxyRaw = document.getElementById('cfg-proxyip').value;
            const proxyList = proxyRaw.split('\\n').map(s => s.trim()).filter(Boolean);
            const newAdminPwd = document.getElementById('cfg-admin-password').value.trim();
            
            const payload = {
                adminPassword: newAdminPwd,
                subToken: document.getElementById('cfg-subtoken').value.trim(),
                yourUUID: document.getElementById('cfg-uuid').value.trim(),
                subPath: document.getElementById('cfg-subpath').value.trim(),
                SSpath: document.getElementById('cfg-sspath').value.trim(),
                ssMethod: document.getElementById('cfg-ssmethod').value,
                ssPsk: document.getElementById('cfg-sspsk').value.trim(),
                disablevless: !document.getElementById('cfg-vless').checked,
                disabletro: !document.getElementById('cfg-trojan').checked,
                disabless: !document.getElementById('cfg-ss').checked,
                landingProxy: landingList[0] || '',
                landingProxies: landingList,
                proxyIP: proxyList[0] || '',
                proxyIPs: proxyList,
                cfip: cfipList,
                clashSubUrl: document.getElementById('cfg-clash-sub').value.trim(),
                singboxSubUrl: document.getElementById('cfg-singbox-sub').value.trim(),
            };

            try {
                const resp = await fetch('/api/config', { credentials: 'same-origin',
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const res = await resp.json();
                if (res.success) {
                    showToast(res.message || '配置已成功保存到 KV！');
                    setTimeout(() => { window.location.reload(); }, 1200);
                } else {
                    alert('保存失败: ' + (res.message || '未知错误'));
                }
            } catch (err) {
                alert('保存网络异常: ' + err.message);
            }
        }

        async function resetAdminConfig() {
            if (!confirm('确定要清除 KV 中存储的配置并恢复为默认设置吗？')) {
                return;
            }
            try {
                const resp = await fetch('/api/reset', { credentials: 'same-origin',
                    method: 'POST'
                });
                const res = await resp.json();
                if (res.success) {
                    showToast(res.message || '已重置为默认配置！');
                    setTimeout(() => { window.location.reload(); }, 1200);
                } else {
                    alert('重置失败: ' + (res.message || '未知错误'));
                }
            } catch (err) {
                alert('重置网络异常: ' + err.message);
            }
        }
        
        function copySubscription() {
            const configUrl = ${escJsStr(`${baseUrl}/${subPathWithToken(config)}`)};
            copyText(configUrl, '全协议订阅链接已复制到剪贴板!');
        }
        
        function copyClashSubscription() {
            const clashUrl = ${escJsStr(clashFullUrl)};
            copyText(clashUrl, 'Clash 订阅链接已复制到剪贴板!');
        }
        
        function copySingboxSubscription() {
            const singboxUrl = ${escJsStr(singboxFullUrl)};
            copyText(singboxUrl, 'Sing-box 订阅链接已复制到剪贴板!');
        }
        
        function copyQXConfig() {
            const qx = ${escJsStr(qxFullConfig)};
            copyText(qx, 'Quantumult X 配置已复制!');
        }

        function copyText(text, msg) {
            navigator.clipboard.writeText(text).then(() => {
                showToast(msg);
            }).catch(() => {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                showToast(msg);
            });
        }
        
        if (window.location.search.includes('password=')) {
            const cleanUrl = new URL(window.location);
            cleanUrl.searchParams.delete('password');
            window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search);
        }
        function logout() {
            if (confirm('确定要退出管理面板吗?')) {
                window.location.href = '/admin?logout=1';
            }
        }
        ${qrWidget.jsBlock}
    </script>
</body>
</html>`;

	const respHeaders = {
		'Content-Type': 'text/html;charset=utf-8',
		'Cache-Control': 'no-cache, no-store, must-revalidate',
	};
	if (setCookie) respHeaders['Set-Cookie'] = setCookie;
	return new Response(html, { status: 200, headers: respHeaders });
}
