// Serve one of the existing website's pages unchanged, including its own styles and scripts.
export function staticPage(html: string) {
  return {
    handlers: {
      GET: () =>
        new Response(html, {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    },
  };
}
