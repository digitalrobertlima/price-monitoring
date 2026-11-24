# Próximo grande passo: app Android nativo, sem Play Store

## Objetivo

Um APK instalável, gerado **pelo GitHub Actions**, publicado nos **Releases do próprio repositório**. Sem conta na Play Store e sem servidor.

## Caminho escolhido: Capacitor com os arquivos dentro do APK

- O site inteiro (HTML, JS, fontes, vozes) vai **dentro** do aplicativo. Abre sem internet, e um ataque ao site não muda o app que a pessoa já instalou.
- O Capacitor é gratuito e de código aberto. Ele dá acesso ao que o navegador não deixa:
  - biometria nativa;
  - notificações com o app fechado, via agendamento local, sem servidor;
  - câmera para QR;
  - armazenamento seguro (Android Keystore) para a chave cifrada do cofre;
  - bloqueio de print na tela das palavras (FLAG_SECURE).
- **Alternativa descartada:** a TWA (o "site como app" da Google) exige um arquivo de verificação na raiz do domínio (`/.well-known/assetlinks.json`). O app fica em `/price-monitoring/` do github.io, onde isso não é possível sem um domínio próprio.

## Build no GitHub Actions (gratuito em repositório público)

1. Um workflow `android.yml` roda quando a versão (`version.js`) muda na main. Ele instala o JDK 17 e o Android SDK e executa `npx cap sync android` e `./gradlew assembleRelease`.
2. **Assinatura:** a chave de assinatura (keystore) fica nos *Secrets* do GitHub (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_PASSWORD`). É gerada uma vez e **nunca pode ser perdida**: sem ela, atualizações não instalam por cima.
3. **Publicação:** o APK vai para um Release (`rdesk-vXX.apk`), junto com o SHA-256 e a impressão digital do certificado de assinatura, para quem quiser conferir.
4. **Atualizações:**
   - O app confere o último Release e oferece baixar a versão nova.
   - Para atualização automática, recomende o **Obtainium**, que acompanha Releases do GitHub e atualiza sozinho.

## Cuidados

- A pessoa precisa permitir "instalar apps desconhecidos". Explique isso com uma lição da Duda.
- Publicar o SHA-256 e a impressão digital do certificado no README e no site, para ninguém instalar um APK falso.
- Manter o PWA funcionando em paralelo: iPhone e Tails continuam pelo navegador.
