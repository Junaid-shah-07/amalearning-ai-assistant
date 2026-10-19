// Speech synthesis utility using Web Speech API with British English preference

export function speakBritishEnglish(text: string, onEnd?: () => void): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false;
  }

  window.speechSynthesis.cancel(); // Stop any active speech

  const cleanText = text
    .replace(/[*_#`]/g, '')
    .replace(/•/g, '')
    .replace(/https?:\/\/\S+/g, 'amalearning dot space')
    .replace(/support@amalearning\.space/g, 'support at amalearning dot space');

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = 'en-GB';
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const britishVoice = voices.find(
    (v) => v.lang.startsWith('en-GB') || v.name.includes('UK') || v.name.includes('British') || v.name.includes('George') || v.name.includes('Hazel')
  );

  if (britishVoice) {
    utterance.voice = britishVoice;
  }

  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }

  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeech(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
