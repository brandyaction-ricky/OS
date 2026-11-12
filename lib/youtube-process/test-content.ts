/** Only explicit QA/test prefixes are separated; ordinary topic words and copies stay visible. */
export const isTestContent = (title: string) => /^\s*(?:\[(?:QA(?:\s*(?:테스트|확인|test))?|테스트|TEST)\]|QA(?:테스트|확인)\s*[:：])/i.test(title);
