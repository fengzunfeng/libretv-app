// OkHttp 探针：验证手机壳同款网络栈（HTTP/2 自动协商 + IPv4 优先 + 宽松 TLS）对各采集站的连通性
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.Dns;
import java.net.InetAddress;
import java.net.Inet4Address;
import java.net.UnknownHostException;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

public class OkHttpProbe {
    static final TrustManager[] TRUST_ALL = new TrustManager[] {
        new X509TrustManager() {
            public void checkClientTrusted(X509Certificate[] c, String a) {}
            public void checkServerTrusted(X509Certificate[] c, String a) {}
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
        }
    };
    static final javax.net.ssl.HostnameVerifier PERMISSIVE = (h, s) -> true;

    public static void main(String[] args) throws Exception {
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(null, TRUST_ALL, new SecureRandom());
        OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .followRedirects(true)
            .dns(new Dns() {
                @Override public List<InetAddress> lookup(String hostname) throws UnknownHostException {
                    List<InetAddress> all = Dns.SYSTEM.lookup(hostname);
                    List<InetAddress> v4 = new ArrayList<>();
                    for (InetAddress a : all) if (a instanceof Inet4Address) v4.add(a);
                    return v4.isEmpty() ? all : v4;
                }
            })
            .sslSocketFactory(ctx.getSocketFactory(), (X509TrustManager) TRUST_ALL[0])
            .hostnameVerifier(PERMISSIVE)
            .build();

        String[] urls = {
            "https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8?ac=videolist&wd=%E7%83%AD&pg=1",
            "https://cj.lziapi.com/api.php/provide/vod/from/lzm3u8?ac=videolist&wd=%E7%83%AD&pg=1",
            "https://api.guangsuapi.com/api.php/provide/vod?ac=videolist&wd=%E7%83%AD&pg=1",
            "https://360zy.com/api.php/provide/vod?ac=videolist&wd=%E7%83%AD&pg=1",
            "https://api.apibdzy.com/api.php/provide/vod/from/dbm3u8?ac=videolist&wd=%E7%83%AD&pg=1",
            "http://43.139.196.163:31308/gather/json?wd=%E7%83%AD",
            "https://api.wujinapi.com/api.php/provide/vod?ac=videolist&wd=%E7%83%AD&pg=1",
        };
        StringBuilder sb = new StringBuilder();
        for (String u : urls) {
            sb.append("== ").append(u).append('\n');
            try {
                Request req = new Request.Builder().url(u)
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile")
                    .header("Accept", "*/*")
                    .build();
                Response r = client.newCall(req).execute();
                String proto = r.protocol().toString();
                String body = r.body() != null ? r.body().string() : "";
                int total = 0;
                try {
                    java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"total\"\\s*:\\s*(\\d+)").matcher(body);
                    if (m.find()) total = Integer.parseInt(m.group(1));
                } catch (Exception e) { }
                sb.append("  OK proto=").append(proto).append(" code=").append(r.code())
                  .append(" total=").append(total).append(" len=").append(body.length()).append('\n');
            } catch (Exception e) {
                sb.append("  ERR ").append(e.toString()).append('\n');
            }
        }
        java.nio.file.Files.writeString(java.nio.file.Path.of("C:/LibreTV/probe-okhttp.txt"), sb.toString());
        System.out.println("DONE, see probe-okhttp.txt");
    }
}
