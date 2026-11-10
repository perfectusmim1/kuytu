package app.kuytu.messenger;

import android.graphics.Color;
import android.os.Bundle;
import android.view.Window;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        if (window != null) {
            int bg = Color.parseColor("#121110");
            window.setStatusBarColor(bg);
            window.setNavigationBarColor(bg);
        }
    }
}
