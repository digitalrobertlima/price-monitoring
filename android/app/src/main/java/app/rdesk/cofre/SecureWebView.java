package app.rdesk.cofre;

import android.content.Context;
import android.text.InputType;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.webkit.WebView;

/** WebView que pede ao teclado para não aprender nem sugerir o que é digitado no cofre. */
public class SecureWebView extends WebView {
    public SecureWebView(Context c) { super(c); }

    @Override
    public InputConnection onCreateInputConnection(EditorInfo out) {
        InputConnection ic = super.onCreateInputConnection(out);
        if (out != null) {
            out.imeOptions |= EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING;
            if ((out.inputType & InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_TEXT) {
                out.inputType |= InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;
            }
        }
        return ic;
    }
}
