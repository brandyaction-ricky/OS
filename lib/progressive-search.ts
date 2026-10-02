export async function progressiveSearch<T>(quick: () => Promise<T>, complete: () => Promise<T>, onPartial: (result: T) => void): Promise<{
    result: T;
    partial: boolean;
}> {
    let settled = false;
    const initial = quick().then(result => { if (!settled)
        onPartial(result); return { result }; }, () => null);
    const final = complete().then(result => { settled = true; return { result }; }, () => { settled = true; return null; });
    const full = await final;
    if (full)
        return { ...full, partial: false };
    const first = await initial;
    if (first)
        return { ...first, partial: true };
    throw new Error("검색 결과를 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.");
}
