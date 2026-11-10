package app.kuytu.messenger;

import android.graphics.Color;
import android.os.Bundle;
import android.view.Window;
import com.getcapacitor.BridgeActivity;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends BridgeActivity {
    private static final AtomicBoolean BRIDGE_STARTED = new AtomicBoolean(false);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        ensureEmulatorLocalhostBridge();
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        if (window != null) {
            int bg = Color.parseColor("#121110");
            window.setStatusBarColor(bg);
            window.setNavigationBarColor(bg);
        }
    }

    /**
     * Bridges 127.0.0.1:3000 inside the Android emulator to the host machine's
     * 10.0.2.2:3000 when `adb reverse` is not active, so WebView can load
     * `http://localhost:3000` as a Secure Context (enabling window.crypto.subtle E2EE).
     */
    private static void ensureEmulatorLocalhostBridge() {
        if (!BRIDGE_STARTED.compareAndSet(false, true)) return;
        Thread acceptor = new Thread(() -> {
            ServerSocket server = null;
            try {
                server = new ServerSocket();
                server.setReuseAddress(true);
                server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 3000));
                while (!Thread.currentThread().isInterrupted()) {
                    final Socket client = server.accept();
                    new Thread(() -> pipeSockets(client)).start();
                }
            } catch (IOException ignored) {
                // Port 3000 is already bound (e.g. via `adb reverse tcp:3000 tcp:3000`).
            } finally {
                if (server != null) {
                    try {
                        server.close();
                    } catch (IOException ignored) {}
                }
            }
        }, "kuytu-localhost-bridge");
        acceptor.setDaemon(true);
        acceptor.start();
    }

    private static void pipeSockets(Socket client) {
        Socket upstream = new Socket();
        try {
            upstream.connect(new InetSocketAddress("10.0.2.2", 3000), 4000);
            Thread t1 = new Thread(() -> copyStream(client, upstream));
            Thread t2 = new Thread(() -> copyStream(upstream, client));
            t1.setDaemon(true);
            t2.setDaemon(true);
            t1.start();
            t2.start();
            t1.join();
            t2.join();
        } catch (Exception ignored) {
        } finally {
            try { client.close(); } catch (IOException ignored) {}
            try { upstream.close(); } catch (IOException ignored) {}
        }
    }

    private static void copyStream(Socket inSock, Socket outSock) {
        try {
            InputStream in = inSock.getInputStream();
            OutputStream out = outSock.getOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                out.flush();
            }
            outSock.shutdownOutput();
        } catch (IOException ignored) {}
    }
}
