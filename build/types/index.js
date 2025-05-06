// Type guards for tool arguments
export function isGenerateSpeechArgs(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    if (typeof v.input !== 'string' || v.input.length > 4096)
        return false;
    if (v.voice !== undefined && typeof v.voice !== 'string')
        return false;
    if (v.model !== undefined && typeof v.model !== 'string')
        return false;
    if (v.speed !== undefined) {
        const speed = Number(v.speed);
        if (isNaN(speed) || speed < 0.25 || speed > 4.0)
            return false;
    }
    return true;
}
export function isTranscribeAudioArgs(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    if (typeof v.file !== 'string')
        return false;
    if (v.model !== undefined && typeof v.model !== 'string')
        return false;
    return true;
}
