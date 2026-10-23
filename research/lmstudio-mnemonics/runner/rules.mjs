// Prototype: Portuguese (EU) / Spanish spelling -> how a Pole would spell the sound. Rules only, no model.
const V = 'aeiouáéíóúâêôãõày';
export function ptToPolish(word) {
  let w = word.toLowerCase();
  w = w.replace(/ch/g, 'SZ').replace(/lh/g, 'LI').replace(/nh/g, 'NI')
    .replace(/qu(?=[eiéíê])/g, 'K').replace(/gu(?=[eiéíê])/g, 'G').replace(/qu/g, 'KŁ')
    .replace(/ç/g, 'S').replace(/c(?=[eiéíê])/g, 'S').replace(/g(?=[eiéíê])/g, 'Ż').replace(/j/g, 'Ż')
    .replace(/x/g, 'SZ').replace(/rr/g, 'R').replace(/ss/g, 'S').replace(new RegExp(`(?<=[${V}])s(?=[${V}])`, 'g'), 'Z')
    .replace(/s(?=$|[^aeiouáéíóúâêôãõ])/g, 'SZ').replace(/z$/g, 'SZ').replace(/c/g, 'K').replace(/v/g, 'W').replace(/h/g, '')
    .replace(/o$/g, 'U').replace(/os$/g, 'USZ').replace(/e$/g, '').replace(/ão/g, 'ał').replace(/ei/g, 'EJ').replace(/ou/g, 'O')
    .replace(/[áàâã]/g, 'a').replace(/[éê]/g, 'e').replace(/í/g, 'i').replace(/[óô]/g, 'o').replace(/ú/g, 'u');
  return w.toLowerCase();
}
export function esToPolish(word) {
  let w = word.toLowerCase();
  w = w.replace(/ch/g, 'CZ').replace(/ll/g, 'J').replace(/ñ/g, 'NI').replace(/rr/g, 'R')
    .replace(/qu(?=[eié])/g, 'K').replace(/gu(?=[eié])/g, 'G').replace(/c(?=[eié])/g, 'S').replace(/z/g, 'S')
    .replace(/g(?=[eié])/g, 'CH').replace(/j/g, 'CH').replace(/c/g, 'K').replace(/v/g, 'B').replace(/h/g, '')
    .replace(/y$/g, 'I').replace(/[á]/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i').replace(/ó/g, 'o').replace(/ú/g, 'u');
  return w.toLowerCase();
}
if (process.argv[1].endsWith('rules.mjs')) {
  for (const w of ['janela', 'queijo', 'sapato', 'cozinha', 'cavalo', 'borboleta', 'chave', 'comer', 'cadeira', 'obrigado', 'escova'])
    console.log('pt', w, '→', ptToPolish(w));
  for (const w of ['perro', 'mantequilla', 'gato', 'ventana', 'zapato', 'cerveza', 'jamón'])
    console.log('es', w, '→', esToPolish(w));
}
