import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // O aviso do Vite disparava aos 500 kB e o pacote passou disso: um único
    // ficheiro com React, framer-motion e os doze ecrãs da aplicação. Num
    // produto que se diz "feito para o telemóvel", 190 kB comprimidos só para
    // entrar é caro — e pior, uma correção de texto obriga a descarregar o
    // pacote inteiro de novo.
    //
    // Separar o que muda pouco do que muda muito faz o cache do navegador
    // valer: React e framer-motion mudam uma vez por versão; o código da
    // aplicação muda a cada deploy.
    rollupOptions: {
      output: {
        /*
         * `react-dom/client` é o que o `main.tsx` importa — e é um módulo
         * distinto de `react-dom`. Listar só 'react-dom' punha 4 kB no chunk
         * do React e deixava os ~130 kB do renderer no chunk da aplicação,
         * que é exactamente o que a divisão queria evitar.
         */
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'vendor-motion';
        },
      },
    },
    // 700 kB por chunk em vez de 500: com a divisão acima, nenhum chunk
    // isolado deve chegar perto disto, e o aviso só servia para poluir o log.
    chunkSizeWarningLimit: 700,
  },
});
