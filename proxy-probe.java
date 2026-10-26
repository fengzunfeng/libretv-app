import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;

/** 复现安卓壳 proxy() 的核心逻辑，验证公共采集源在 Java HttpURLConnection 下的连通性 */
public class proxy-probe {
  public static void main(String[] args) throws Exception {
    String[] targets = {
      "https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8?ac=videolist&wd=test&pg=1",
      "https://api.guangsuapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1",
      "https://api.wujinapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1",
      "https://360zy.com/api.php/provide/vod?ac=videolist&wd=test&pg=1",
      "https://api.apibdzy.com/api.php/provide/vod/from/dbm3u8?ac=videolist&wd=test&pg=1",
    };
    for (String t : targets) {
      try {
        URL url = new URL(t);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(90000);
        conn.setRequestProperty("User-Agent",
            "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
        conn.setRequestProperty("Referer", url.getProtocol() + "://" + url.getAuthority());
        conn.setRequestProperty("Accept", "*/*");
        int code = conn.getResponseCode();
        String ct = conn.getContentType();
        System.out.println("CODE=" + code + " CT=" + ct + " URL=" + t.substring(0, Math.min(50, t.length())));
        InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
        char[] buf = new char[120];
        int n = r.read(buf, 0, 120);
        System.out.println("  BODY=" + (n > 0 ? new String(buf, 0, n).replace('\n', ' ') : "empty"));
        conn.disconnect();
      } catch (Exception e) {
        System.out.println("FAIL " + e.toString() + " URL=" + t.substring(0, Math.min(50, t.length())));
      }
    }
  }
}
