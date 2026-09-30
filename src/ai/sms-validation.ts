const basic=new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,\-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà');
const ext=new Set(['^','{','}','\\','[','~',']','|','€','\f']);
export function gsm7Septets(text:string):number|null{let n=0;for(const c of text){if(basic.has(c))n++;else if(ext.has(c))n+=2;else return null;}return n;}
export function validateSingleSegment(text:string):{ok:true;septets:number;segments:1}|{ok:false;reason:string}{const t=text.trim();if(!t)return {ok:false,reason:'empty'};const s=gsm7Septets(t);if(s===null)return {ok:false,reason:'non_gsm7'};if(s>160)return {ok:false,reason:'multiple_segments'};return {ok:true,septets:s,segments:1};}
