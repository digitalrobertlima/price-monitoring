/* =========================================================================
   CONTEÚDO DAS LIÇÕES (Duda e Bit)
   - say: o que aparece no balão.  voice: o que é falado (quando difere: siglas soletradas,
     números por extenso). As vozes naturais são geradas a partir daqui por
     tools/vozes (Kokoro, licença Apache 2.0) e ficam em audio/.
   - art: desenho da cena (learn.js).  quiz: pergunta de tocar.  action: prática no app.
   Fatos conferidos em fontes públicas (nov/2026): BRZ (Transfero, 2019), BRLA (Avenia),
   USDT (Tether, 2014), USDC (Circle, 2018), Drex (BC desligou a plataforma com blockchain
   em nov/2025), reserva de bitcoin dos EUA (ordem executiva, mar/2025).
   ========================================================================= */
(function (global) {
    'use strict';
    const LESSONS = [
        {
            id: 'dinheiro', icon: '💵', title: 'O que é dinheiro?', scenes: [
                { who: 'duda', art: 'barter', say: 'Antigamente não existia dinheiro. Quem tinha galinha trocava por milho, direto.' },
                { who: 'bit', art: 'barter', say: 'Mas e se o dono do milho não quisesse galinha? Aí complicava!' },
                { who: 'duda', art: 'history', say: 'Por isso inventaram o dinheiro: primeiro conchas, depois moedas, papel, e hoje o Pix.' },
                { who: 'bit', art: 'history', say: 'E agora tem eu: o Bitcoin, dinheiro que vive na internet!' },
                { who: 'duda', art: 'history', say: 'Pergunta rápida:', quiz: { q: 'Pra que serve o dinheiro?', options: [['🔄 Trocar por coisas e guardar valor', true], ['🎀 Só para enfeitar', false], ['🤷 Pra nada', false]] } }
            ]
        },
        {
            id: 'inflacao', icon: '🥟', title: 'Por que tudo fica mais caro?', scenes: [
                { who: 'duda', art: 'pastel', say: 'Já reparou que o pastel vai ficando mais caro com o tempo? O pastel é o mesmo. Quem perdeu valor foi o dinheiro.' },
                { who: 'bit', art: 'printer', say: 'É que o governo pode imprimir mais dinheiro. Quanto mais nota existe, menos cada uma vale.' },
                { who: 'duda', art: 'printer', say: 'Nos anos 80 e 90, aqui no Brasil, os preços chegavam a mudar todo dia. Chamamos isso de inflação.', voice: 'Nos anos oitenta e noventa, aqui no Brasil, os preços chegavam a mudar todo dia. Chamamos isso de inflação.' },
                { who: 'duda', art: 'pastel', say: 'Pergunta rápida:', quiz: { q: 'Quando imprimem muito dinheiro, o pastel…', options: [['📈 Fica mais caro', true], ['📉 Fica mais barato', false], ['➖ Não muda nada', false]] } }
            ]
        },
        {
            id: 'bitcoin', icon: '₿', title: 'O que é o Bitcoin?', scenes: [
                { who: 'bit', art: 'genesis', say: 'Eu nasci em 2009, logo depois de uma grande crise dos bancos. Quem me criou usou um apelido: Satoshi Nakamoto.', voice: 'Eu nasci em dois mil e nove, logo depois de uma grande crise dos bancos. Quem me criou usou um apelido: Satoshi Nakamoto.' },
                { who: 'duda', art: 'limit', say: 'O mais importante: só vão existir 21 milhões de bitcoins. Ninguém pode imprimir mais. Nem governo, nem banco, nem empresa.', voice: 'O mais importante: só vão existir vinte e um milhões de bitcoins. Ninguém pode imprimir mais. Nem governo, nem banco, nem empresa.' },
                { who: 'bit', art: 'network', say: 'E eu não tenho dono! Milhares de computadores no mundo todo cuidam de mim, 24 horas por dia, desde 2009.', voice: 'E eu não tenho dono! Milhares de computadores no mundo todo cuidam de mim, vinte e quatro horas por dia, desde dois mil e nove.' },
                { who: 'duda', art: 'limit', say: 'Por isso muita gente usa o Bitcoin para guardar valor por muitos anos. O preço sobe e desce bastante no caminho, então pense no longo prazo.' },
                { who: 'bit', art: 'limit', say: 'Valendo!', quiz: { q: 'Quantos bitcoins vão existir no máximo?', options: [['🔒 21 milhões', true], ['♾️ Infinitos', false], ['🏦 O banco decide', false]] }, voice: 'Valendo! Quantos bitcoins vão existir no máximo?' }
            ]
        },
        {
            id: 'real-dolar', icon: '💱', title: 'Real, dólar e Bitcoin', scenes: [
                { who: 'duda', art: 'fx1994', say: 'O real nasceu em 1994. Naquela época, um real valia mais ou menos um dólar.', voice: 'O real nasceu em mil novecentos e noventa e quatro. Naquela época, um real valia mais ou menos um dólar.' },
                { who: 'bit', art: 'fxnow', say: 'Olha aí quanto custa um dólar hoje, em reais. Bem mais, né?' },
                { who: 'duda', art: 'fxnow', say: 'Ou seja: com o tempo, o real perdeu valor frente ao dólar. E o próprio dólar também perde valor, só que mais devagar.' },
                { who: 'bit', art: 'fxbtc', say: 'E eu? Meu preço é em dólar, no mundo inteiro. Pra saber quanto eu valho em reais, é só multiplicar pelo dólar.' },
                { who: 'duda', art: 'fxbtc', say: 'Por isso, pra quem vive no Brasil, o Bitcoin sobe quando ele valoriza e também quando o dólar sobe. São duas forças juntas.' },
                { who: 'bit', art: 'fxbtc', say: 'Valendo!', quiz: { q: 'O dólar subiu e o bitcoin ficou parado em dólar. Em reais, o bitcoin…', options: [['📈 Subiu', true], ['📉 Caiu', false], ['➖ Ficou igual', false]] }, voice: 'Valendo! O dólar subiu e o bitcoin ficou parado em dólar. Em reais, o bitcoin…' }
            ]
        },
        {
            id: 'mundo', icon: '🌎', title: 'Por que o Bitcoin ganha das moedas?', scenes: [
                { who: 'duda', art: 'printer', say: 'Os países do mundo todo criam dinheiro novo todo ano: real, dólar, euro. Tem cada vez mais nota.' },
                { who: 'bit', art: 'supply', say: 'Já eu tenho limite! E a cada quatro anos, a quantidade de bitcoin novo cai pela metade. Isso se chama halving.', voice: 'Já eu tenho limite! E a cada quatro anos, a quantidade de bitcoin novo cai pela metade. Isso se chama rálvin.' },
                { who: 'duda', art: 'supply', say: 'Quando um dinheiro aumenta sem parar e o outro tem limite, no longo prazo o que tem limite tende a valer mais. É a lei da oferta e da procura.' },
                { who: 'bit', art: 'world', say: 'Hoje até grandes empresas, fundos de investimento e governos guardam bitcoin. Os Estados Unidos criaram uma reserva de bitcoin em 2025.', voice: 'Hoje até grandes empresas, fundos de investimento e governos guardam bitcoin. Os Estados Unidos criaram uma reserva de bitcoin em dois mil e vinte e cinco.' },
                { who: 'duda', art: 'coaster', say: 'Mas atenção: o preço sobe e desce muito. Já caiu mais da metade várias vezes antes de voltar. Só coloque o que pode deixar guardado por anos.' },
                { who: 'bit', art: 'supply', say: 'Valendo!', quiz: { q: 'Por que o bitcoin tende a ganhar das moedas no longo prazo?', options: [['🔒 Tem limite: ninguém imprime mais', true], ['🎲 Pura sorte', false], ['🏦 O banco garante', false]] }, voice: 'Valendo! Por que o bitcoin tende a ganhar das moedas no longo prazo?' }
            ]
        },
        {
            id: 'blockchain', icon: '🧱', title: 'O que é blockchain?', scenes: [
                { who: 'duda', art: 'ledger', say: 'Blockchain é um caderno de contas. Toda vez que alguém manda uma moeda, uma linha nova é escrita.' },
                { who: 'bit', art: 'copies', say: 'Só que esse caderno não fica num lugar só: milhares de computadores têm uma cópia igualzinha.' },
                { who: 'duda', art: 'chain', say: 'As páginas são os blocos, e cada bloco fica preso no anterior, como uma corrente. Por isso o nome: corrente de blocos.' },
                { who: 'bit', art: 'copies', say: 'Pra mudar uma linha, alguém teria que mudar a cópia de quase todo mundo ao mesmo tempo. É praticamente impossível!' },
                { who: 'duda', art: 'roads', say: 'Cada blockchain é uma rede, tipo uma estrada: Bitcoin, Ethereum, Polygon. A moeda viaja pela estrada certa, e a taxa é o pedágio.' },
                { who: 'bit', art: 'roads', say: 'Valendo!', quiz: { q: 'Se você mandar uma moeda pela rede errada…', options: [['⚠️ Ela pode se perder', true], ['✅ Chega do mesmo jeito', false], ['🔁 Volta sozinha', false]] }, voice: 'Valendo! Se você mandar uma moeda pela rede errada…' }
            ]
        },
        {
            id: 'chave', icon: '🔑', title: 'A chave e o cofre', scenes: [
                { who: 'duda', art: 'bank', say: 'No banco, quem guarda a chave do cofre é o banco. Aqui é diferente: a chave é só sua.' },
                { who: 'bit', art: 'key', say: 'A chave são 12 palavras. O app cria pra você. Você só precisa escrever no papel, na ordem.', voice: 'A chave são doze palavras. O app cria pra você. Você só precisa escrever no papel, na ordem.' },
                { who: 'duda', art: 'key', say: 'Quem tem as 12 palavras abre o cofre. Por isso: nunca mostre, nunca mande foto, nunca conte pra ninguém.', voice: 'Quem tem as doze palavras abre o cofre. Por isso: nunca mostre, nunca mande foto, nunca conte pra ninguém.' },
                { who: 'bit', art: 'scam', say: 'Nem pra quem disser que é do suporte! Ninguém de verdade vai pedir suas palavras.', quiz: { q: 'Alguém do “suporte” pede suas 12 palavras. Você…', options: [['🚫 Não passa de jeito nenhum', true], ['📲 Manda pelo WhatsApp', false], ['✂️ Manda só metade', false]] }, voice: 'Nem pra quem disser que é do suporte! Ninguém de verdade vai pedir suas palavras. Alguém do suporte pede suas doze palavras. Você…' },
                { who: 'duda', art: 'key', say: 'Agora é com você!', action: { kind: 'create-wallet', label: '🔑 Criar meu cofre agora', onlyIfNoWallet: true } }
            ]
        },
        {
            id: 'receber', icon: '📲', title: 'Receber o primeiro valor', scenes: [
                { who: 'duda', art: 'qr', say: 'Pra receber, você mostra o seu código. É tipo uma chave Pix, só que da sua carteira.' },
                { who: 'bit', art: 'qr', say: 'A pessoa lê o código e eu chego voando na sua carteira!' },
                { who: 'duda', art: 'qr', say: 'Confira sempre a rede: é o caminho por onde a moeda viaja. Os dois lados precisam usar a mesma.' },
                { who: 'duda', art: 'qr', say: 'Bora ver o seu código?', action: { kind: 'receive', label: '📲 Ver meu código de receber' } }
            ]
        },
        {
            id: 'redes', icon: '🌳', title: 'Bitcoin e as redes novas', scenes: [
                { who: 'duda', art: 'trees', say: 'Pense numa árvore. O Bitcoin é a árvore mais velha e forte: está de pé desde 2009.', voice: 'Pense numa árvore. O Bitcoin é a árvore mais velha e forte: está de pé desde dois mil e nove.' },
                { who: 'bit', art: 'trees', say: 'A Ethereum veio em 2015. Também é forte.', voice: 'A Ethereum veio em dois mil e quinze. Também é forte.' },
                { who: 'duda', art: 'trees', say: 'As redes mais novas são práticas e baratas, mas ainda estão crescendo e podem ter problemas. Use pra movimentar, e guarde o grosso no Bitcoin.' },
                { who: 'bit', art: 'trees', say: 'Valendo!', quiz: { q: 'Onde é mais seguro guardar por muitos anos?', options: [['🌳 No Bitcoin', true], ['🌱 Na rede mais nova', false], ['🎲 Tanto faz', false]] }, voice: 'Valendo! Onde é mais seguro guardar por muitos anos?' }
            ]
        },
        {
            id: 'stablecoins', icon: '🪙', title: 'Dólar e real digitais', scenes: [
                { who: 'duda', art: 'stable', say: 'Stablecoin é uma moeda digital que vale sempre o mesmo que uma moeda comum. Um pra um.', voice: 'Estêibou côin é uma moeda digital que vale sempre o mesmo que uma moeda comum. Um pra um.' },
                { who: 'bit', art: 'reserve', say: 'Funciona assim: uma empresa guarda o dinheiro de verdade e cria a mesma quantidade em moeda digital.' },
                { who: 'duda', art: 'usd2', say: 'No dólar, as duas maiores são de empresas diferentes. O USDT, da Tether, é o maior e mais antigo, de 2014. O USDC, da Circle, é de uma empresa americana com regras mais rígidas e relatório todo mês.', voice: 'No dólar, as duas maiores são de empresas diferentes. O U S D T, da Tether, é o maior e mais antigo, de dois mil e catorze. O U S D C, da Circle, é de uma empresa americana com regras mais rígidas e relatório todo mês.' },
                { who: 'bit', art: 'usd2', say: 'Por isso existem dois dólares: cada empresa tem o seu. Os dois valem um dólar, mas a confiança depende de quem guarda o dinheiro.' },
                { who: 'duda', art: 'brl2', say: 'Com o real é igual. O BRZ é da Transfero, existe desde 2019 e roda em várias redes. O BRLA é da Avenia, muito usado na Polygon e na Celo.', voice: 'Com o real é igual. O B R Z é da Transfero, existe desde dois mil e dezenove e roda em várias redes. O B R L A é da Avenia, muito usado na Polygon e na Celo.' },
                { who: 'bit', art: 'brlnets', say: 'Hoje o real digital circula principalmente nas redes Celo e Polygon. E tem outros chegando, de bancos e corretoras brasileiras.' },
                { who: 'duda', art: 'drex', say: 'E o Drex, o real digital do Banco Central? Ele não chegou às pessoas: em 2025 o Banco Central desligou a versão com blockchain.', voice: 'E o Drex, o real digital do Banco Central? Ele não chegou às pessoas: em dois mil e vinte e cinco o Banco Central desligou a versão com blockchain.' },
                { who: 'duda', art: 'reserve', say: 'Stablecoin é ótima pra guardar reais ou dólares por pouco tempo e mandar rápido. Mas lembre: você está confiando na empresa que guarda o dinheiro.' },
                { who: 'bit', art: 'brl2', say: 'Valendo!', quiz: { q: 'Qual a diferença entre BRZ e BRLA?', options: [['🏢 São de empresas diferentes', true], ['💸 Um vale mais que o outro', false], ['🤷 Nenhuma, é a mesma coisa', false]] }, voice: 'Valendo! Qual a diferença entre B R Z e B R L A?' }
            ]
        },
        {
            id: 'golpes', icon: '🚩', title: 'Como não cair em golpe', scenes: [
                { who: 'duda', art: 'guarantee', say: 'Se alguém promete lucro garantido todo mês, desconfie. Ninguém consegue garantir isso.' },
                { who: 'bit', art: 'scam', say: 'E nunca, nunca passe suas 12 palavras. Nem pra amigo, nem pra parente, nem pra suporte.', voice: 'E nunca, nunca passe suas doze palavras. Nem pra amigo, nem pra parente, nem pra suporte.' },
                { who: 'duda', art: 'guarantee', say: 'Na dúvida, pare e pergunte pra alguém de confiança. Pressa é a arma do golpista.' },
                { who: 'bit', art: 'guarantee', say: 'Valendo!', quiz: { q: 'Prometeram 10% por mês garantido. Isso é…', options: [['🚩 Sinal de golpe', true], ['💎 Ótimo negócio', false], ['😴 Normal', false]] }, voice: 'Valendo! Prometeram dez por cento por mês, garantido. Isso é…' }
            ]
        },
        {
            id: 'render', icon: '📈', title: 'Fazer o dinheiro trabalhar', scenes: [
                { who: 'duda', art: 'feira', say: 'Pensa numa feira de trocas. Você coloca suas moedas na barraca, e cada pessoa que troca deixa um trocadinho pra você.' },
                { who: 'bit', art: 'feira', say: 'Isso é o Render! Mas atenção: se o preço mudar muito, você pode terminar com mais de uma moeda e menos da outra.' },
                { who: 'duda', art: 'feira', say: 'Ganho não é garantido. Use só uma parte do dinheiro, e guarde a reserva no Bitcoin.', action: { kind: 'tab:earn', label: '📈 Conhecer o Render' } }
            ]
        },
        {
            id: 'pix', icon: '💸', title: 'Comprar com Pix', scenes: [
                { who: 'duda', art: 'pix', say: 'Em breve você vai poder comprar cripto só mandando um Pix, do jeito que você já faz todo dia.' },
                { who: 'bit', art: 'pix', say: 'Você paga o Pix e eu caio direto no seu cofre!', action: { kind: 'buy-pix', label: '💸 Ver como vai funcionar' } }
            ]
        }
    ];

    const WELCOME = {
        id: 'boasvindas', icon: '👋', title: 'Boas-vindas', scenes: [
            { who: 'duda', art: 'hello', say: 'Oi! Eu sou a Duda. Vou te acompanhar aqui dentro.' },
            { who: 'bit', art: 'hello', say: 'E eu sou o Bit, uma moeda de Bitcoin! Prazer!' },
            { who: 'duda', art: 'bank', say: 'Aqui você tem um cofre de dinheiro digital que só você abre.' },
            { who: 'duda', art: 'hello', say: 'Antes de mexer no seu dinheiro, eu te ensino o básico em poucos minutinhos. Bora?' }
        ]
    };
    const WELCOME_TRAIL = ['dinheiro', 'inflacao', 'bitcoin', 'chave'];

    // Falas curtas de reação (também ganham voz natural)
    const REACTIONS = {
        right: { who: 'bit', say: 'Acertou!' },
        wrong: { who: 'duda', say: 'Quase! Tenta de novo.' },
        done: { who: 'duda', say: 'Lição concluída! Mandou bem!' }
    };

    // Texto que vira voz (o mesmo usado para gerar os áudios e para achá-los)
    const spoken = (scene) => scene.voice || (scene.say + (scene.quiz ? ` ${scene.quiz.q}` : ''));
    // Nome do arquivo de áudio: quem fala + impressão digital do texto (texto mudou = áudio novo)
    function voiceKey(who, text) {
        let h = 0x811c9dc5;
        const s = `${who}|${text}`;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
        return `${who}-${h.toString(16).padStart(8, '0')}`;
    }
    function allLines() {
        const out = [];
        const add = (who, text) => { const key = voiceKey(who, text); if (!out.some((l) => l.key === key)) out.push({ key, who, text }); };
        [WELCOME, ...LESSONS].forEach((l) => l.scenes.forEach((s) => add(s.who, spoken(s))));
        Object.values(REACTIONS).forEach((r) => add(r.who, r.say));
        return out;
    }

    global.RDESK_LESSONS = { LESSONS, WELCOME, WELCOME_TRAIL, REACTIONS, spoken, voiceKey, allLines };
})(typeof window !== 'undefined' ? window : globalThis);
