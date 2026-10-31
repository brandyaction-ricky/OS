// 최종 화면 진단 카드 (로건 요청 10/30): the diagnosis link element every video's end screen carries, kept once for the company.
// YouTube takes end screens only in Studio, so the 업로드 screen shows these values to put there.
export interface EndscreenCard { name: string; cta: string; link: string; image: string }
export const ENDSCREEN_CARD_DEFAULT: EndscreenCard = { name: "", cta: "자세히 알아보기", link: "", image: "" };
// ponytail: the square image (YouTube shows it small) stays inline in the record up to 300KB; move it to storage if it ever needs to be bigger.
export const ENDSCREEN_IMAGE_MAX = 400_000;
