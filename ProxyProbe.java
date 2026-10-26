import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;

/** 复现安卓壳 proxy() 核心逻辑：逐个源测试，捕获全部异常（含 Error） */
public class ProxyProbe {
  public static void main(String[] args) throws Exception {
    String[] targets = {
      "https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8?ac=videolist&wd=test&pg=1",
      "https://cj.lziapi.com/api.php/provide/vod/from/lzm3u8?ac=videolist&wd=test&pg=1",
      "https://api.guangsuapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1",
      "https://api.wujinapi.com/api.php/provide/vod?ac=videolist&wd=test&pg=1",
      "https://360zy.com/api.php/provide/vod?ac=videolist&wd=test&pg=1",
      "https://api.apibdzy.com/api.php/provide/vod/from/dbm3u8?ac=videolist&wd=test&pg=1",
    };
    int i = 0;
    for (String t : targets) {
      i++;
      System.out.println("[" + i + "] TRYING " + t.substring(0, Math.min(60, t.length())) + " ...");
      try {
        URL url = new URL(t);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(45000);
        conn.setRequestProperty("User-Agent",
            "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
        conn.setRequestProperty("Referer", url.getProtocol() + "://" + url.getAuthority());
        conn.setRequestProperty("Accept", "*/*");
        int code = conn.getResponseCode();
        String ct = conn.getContentType();
        System.out.println("  OK code=" + code + " ct=" + ct);
        InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
        char[] buf = new char[80];
        int n = r.read(buf, 0, 80);
        System.out.println("  BODY=" + (n > 0 ? new String(buf, 0, n).replace('\n', ' ') : "empty"));
        conn.disconnect();
      } catch (Throwable e) {
        System.out.println("  THROW " + e.getClass().getName() + ": " + e.getMessage());
        for (StackTraceElement s : e.getStackTrace()) {
          System.out.println("    at " + s);
        }
      }
    }
    System.out.println("DONE");
  }
}