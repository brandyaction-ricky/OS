import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { ApiError } from "@/lib/http";

const MAX_BYTES = 500_000;
export function canonicalSourceUrl(value: string, allowedHosts = process.env.CANONICAL_SOURCE_HOSTS ?? "") {
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(400,"SOURCE_URL_INVALID","HTTPS 원문 주소를 확인해 주세요."); }
  const hosts = allowedHosts.split(",").map(host=>host.trim().toLowerCase()).filter(Boolean);
  if (url.protocol !== "https:" || url.port && url.port !== "443" || url.username || url.password || url.search || url.hash || !hosts.includes(url.hostname)) {
    throw new ApiError(400,"SOURCE_HOST_NOT_ALLOWED","관리자가 허용한 HTTPS 호스트의 Markdown·텍스트 주소만 연결할 수 있습니다. 인증·쿼리 문자열은 사용할 수 없습니다.");
  }
  return url;
}

// IPv4-only, globally routable addresses. The checked address is pinned into
// the TLS request's lookup callback, preventing DNS rebinding between checks.
export function publicSourceIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part=>!Number.isInteger(part)||part<0||part>255)) return false;
  const [a,b,c] = parts;
  return !(a===0 || a===10 || a===127 || a>=224 || a===169&&b===254 || a===172&&b>=16&&b<=31 || a===192&&b===168 || a===100&&b>=64&&b<=127 || a===198&&(b===18||b===19) || a===192&&b===0 || a===192&&b===2 || a===198&&b===51&&c===100 || a===203&&b===0&&c===113);
}

export async function fetchCanonicalSource(value: string) {
  const url = canonicalSourceUrl(value);
  const addresses = await lookup(url.hostname,{all:true,family:4}).catch(()=>[]);
  if (!addresses.length || addresses.some(row=>!publicSourceIpv4(row.address))) throw new ApiError(400,"SOURCE_ADDRESS_BLOCKED","공개 원문 서버 주소를 확인할 수 없습니다.");
  return new Promise<string>((resolve,reject)=>{
    const req = request(url,{method:"GET",family:4,headers:{accept:"text/markdown, text/plain", "accept-encoding":"identity"},
      lookup:(_hostname,_options,callback)=>callback(null,addresses[0].address,4),
    },response=>{
      const type = response.headers["content-type"]?.split(";")[0].trim().toLowerCase();
      if (response.statusCode !== 200 || !["text/plain","text/markdown","text/x-markdown"].includes(type??"")) {
        response.destroy(); reject(new ApiError(422,"SOURCE_RESPONSE_UNSUPPORTED","원문을 읽지 못했습니다. 로그인·리디렉션 없는 Markdown/텍스트 응답이 필요합니다.")); return;
      }
      let size=0;const chunks:Buffer[]=[];
      response.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size>MAX_BYTES){response.destroy(new Error("limit"));}else chunks.push(chunk);});
      response.on("error",()=>reject(new ApiError(502,"SOURCE_READ_FAILED","원문이 크거나 전송이 중단되었습니다. 500KB 이하 파일로 다시 확인해 주세요.")));
      response.on("end",()=>{const content=Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/,"").replace(/\r\n/g,"\n");if(!content.trim()||content.includes("\u0000"))reject(new ApiError(422,"SOURCE_EMPTY","비어 있거나 지원하지 않는 원문입니다."));else resolve(content);});
    });
    const timer=setTimeout(()=>req.destroy(new Error("timeout")),15_000);
    req.on("close",()=>clearTimeout(timer));
    req.on("error",()=>reject(new ApiError(502,"SOURCE_FETCH_FAILED","원문 연결에 실패했습니다. 회사 정본은 변경하지 않았습니다.")));
    req.end();
  });
}
