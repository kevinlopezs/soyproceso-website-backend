import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  conParametros, emailValido, estaIndexada, generarOtp, hashOtp, igualesSeguro, resumenPost,
  traducirCobertura, urlDePost, urlInspeccionGsc, urlPermitida,
} from "./blog-utils.ts";

Deno.test("OTP: 6 dígitos y hash verificable", async () => {
  for (let i = 0; i < 200; i++) assert(/^\d{6}$/.test(generarOtp()));
  const h = await hashOtp("123456", "salt");
  assert(igualesSeguro(h, await hashOtp("123456", "salt")));
  assert(!igualesSeguro(h, await hashOtp("123457", "salt")));
  assert(!igualesSeguro(h, await hashOtp("123456", "otra")));
});

Deno.test("redirect del tracking: solo soyproceso.com por https", () => {
  assert(urlPermitida("https://www.soyproceso.com/blog/x"));
  assert(urlPermitida("https://soyproceso.com/"));
  assert(!urlPermitida("http://www.soyproceso.com/"));
  assert(!urlPermitida("https://evil.com/?u=www.soyproceso.com"));
  assert(!urlPermitida("https://www.soyproceso.com.evil.com/"));
  assert(!urlPermitida("javascript:alert(1)"));
  assert(!urlPermitida("//evil.com"));
});

Deno.test("conParametros agrega utm y sp_t", () => {
  const u = conParametros("https://www.soyproceso.com/blog/a", { utm_source: "newsletter", sp_t: "tok" });
  assertEquals(new URL(u).searchParams.get("sp_t"), "tok");
});

Deno.test("emailValido", () => {
  assert(emailValido("Ana@empresa.com"));
  assert(!emailValido("ana@mailinator.com"));
  assert(!emailValido("sin-arroba"));
});

Deno.test("resumenPost corta en palabra y limpia HTML", () => {
  assertEquals(resumenPost("  Hola mundo ", null), "Hola mundo");
  const r = resumenPost(null, "<p>" + "palabra ".repeat(60) + "</p>", 50);
  assert(r.length <= 51 && r.endsWith("…") && !r.includes("<"));
});

Deno.test("cobertura de Google", () => {
  assertEquals(traducirCobertura("Submitted and indexed"), "Indexada");
  assert(estaIndexada("PASS", "Submitted and indexed"));
  assert(!estaIndexada("NEUTRAL", "Crawled - currently not indexed"));
  assert(traducirCobertura("Discovered - currently not indexed").startsWith("Descubierta"));
  assert(traducirCobertura("Duplicate, Google chose different canonical than user").startsWith("Duplicada"));
});

Deno.test("urls de blog y de Search Console", () => {
  assertEquals(urlDePost("mi-post"), "https://www.soyproceso.com/blog/mi-post");
  const g = urlInspeccionGsc(urlDePost("mi-post"));
  assert(g.includes("resource_id=sc-domain%3Asoyproceso.com") && g.includes(encodeURIComponent("https://www.soyproceso.com/blog/mi-post")));
});
