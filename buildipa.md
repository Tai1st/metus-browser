# Build IPA cho Expo / React Native bằng GitHub Actions từ Windows

Hướng dẫn tạo file **IPA chưa ký**, tải về và ký lại bằng ESign với chứng chỉ và provisioning profile của bạn.

Bạn viết code và sử dụng GitHub trên Windows. Máy macOS của GitHub Actions cài thư viện và chạy Xcode để biên dịch iOS. Bạn không cần sở hữu máy Mac để thực hiện quy trình này.

> Đây là workflow mẫu cho project Expo dùng npm, nằm ở thư mục gốc repository. Chưa được chạy với mã nguồn app của bạn. Cần điều chỉnh tên workspace, scheme và phiên bản công cụ theo project. Project có app extension hoặc entitlement đặc biệt có thể cần cấu hình bổ sung.

## 1. Kết quả nhận được

| Thành phần | Kết quả |
| --- | --- |
| Máy thao tác | Windows |
| Máy thực hiện build | GitHub-hosted macOS runner |
| Công cụ | Expo Prebuild, CocoaPods, Xcode CLI |
| Chế độ build | Release, dành cho iPhone/iPad thật |
| File tải về | `App-unsigned.ipa` trong artifact ZIP |
| Code signing trong workflow | Tắt |
| Cài trực tiếp IPA chưa ký | Không |
| Ký sau khi tải | Dùng ESign với bộ chứng chỉ/profile phù hợp |
| Tự động đưa lên TestFlight | Không nằm trong workflow này |

Không dùng bản build iOS Simulator để đóng gói thành IPA cài lên thiết bị thật.

## 2. Chuẩn bị

- Tài khoản GitHub và repository chứa mã nguồn app; nên dùng repository private nếu mã nguồn không công khai.
- GitHub Actions được bật cho repository.
- `package.json` và `package-lock.json` khớp nhau, được commit.
- `app.json` hoặc `app.config.js` / `app.config.ts` có cấu hình iOS hợp lệ.
- Các asset, config plugin và native module cần thiết được đưa vào repository.
- Chọn Node.js và Xcode tương thích với Expo SDK / React Native của app.
- Để ký và cài sau build: chuẩn bị chứng chỉ, mật khẩu `.p12` và provisioning profile phù hợp.

Workflow build chưa ký không cần bạn tải chứng chỉ Apple lên GitHub, không cần `EXPO_TOKEN` và không gọi dịch vụ EAS Build. Nếu app có package riêng hoặc cấu hình riêng, vẫn cần cung cấp các biến môi trường tương ứng.

## 3. Cấu hình Expo

Ví dụ `app.json`:

```json
{
  "expo": {
    "name": "Metus",
    "slug": "metus",
    "version": "1.0.0",
    "ios": {
      "bundleIdentifier": "com.metus.browser",
      "buildNumber": "1",
      "supportsTablet": true
    }
  }
}
```

Gộp các trường cần thiết vào cấu hình đang có, không thay toàn bộ cấu hình hiện tại bằng ví dụ này. Thay Bundle ID bằng ID của app bạn.

`name`, `slug`, Bundle ID và Xcode scheme có mục đích khác nhau. Không giả định scheme luôn trùng với tên hiển thị; kiểm tra project native hoặc log liệt kê Xcode trong workflow.

Nếu project đã có thư mục `ios` được quản lý thủ công, thay đổi trong Expo config không tự động cập nhật toàn bộ project native vì workflow dưới đây bỏ qua Prebuild khi `ios` tồn tại.

## 4. Kiểm tra trên Windows

Mở PowerShell ở thư mục project:

```powershell
npm ci
npx expo-doctor
npx expo config --type public
```

Nếu chưa có `package-lock.json`, chạy `npm install` rồi commit file khóa. Không dùng `npm install` chỉ để che lỗi xung đột phiên bản; xử lý nguyên nhân nếu các gói không tương thích.

Các lệnh trên kiểm tra dependency và cấu hình. Việc biên dịch iOS sẽ được thực hiện trên macOS của GitHub.

## 5. Cấu trúc repository

| Đường dẫn | Vai trò |
| --- | --- |
| `package.json` | Dependency và script |
| `package-lock.json` | Khóa phiên bản cho npm |
| `app.json` hoặc `app.config.*` | Cấu hình Expo |
| `assets/` | Icon, splash, font và tài nguyên |
| `app/` hoặc `src/` | Mã nguồn, tùy cấu trúc app |
| `ios/` | Có thể chưa tồn tại với Expo CNG; Prebuild sẽ tạo |
| `.github/workflows/build-ios.yml` | Workflow build |

Với Expo CNG, `ios/` thường nằm trong `.gitignore`. Với project native được chỉnh trực tiếp, cần commit các thay đổi native cần giữ. Không chạy `prebuild --clean` tùy tiện với project có chỉnh sửa native chưa được đưa vào config plugin.

## 6. Tạo workflow

Tạo file `.github/workflows/build-ios.yml` trong repository và dán nội dung dưới đây.

Mặc định dùng `ios/Metus.xcworkspace` và scheme `Metus`. Bạn có thể sửa mặc định trong YAML hoặc nhập lại khi bấm chạy. Node 22 và `macos-15` là lựa chọn mẫu, cần đổi nếu SDK của bạn yêu cầu phiên bản khác.

```yaml
name: Build unsigned iOS IPA

on:
  workflow_dispatch:
    inputs:
      workspace:
        description: Xcode workspace path
        required: true
        default: ios/Metus.xcworkspace
        type: string
      scheme:
        description: Xcode application scheme
        required: true
        default: Metus
        type: string

permissions:
  contents: read

jobs:
  build:
    runs-on: macos-15
    timeout-minutes: 60

    defaults:
      run:
        shell: bash

    env:
      CI: "1"
      WORKSPACE: ${{ inputs.workspace }}
      SCHEME: ${{ inputs.scheme }}

    steps:
      - name: Checkout source
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm

      - name: Show tool versions
        run: |
          node --version
          npm --version
          xcodebuild -version

      - name: Install JavaScript dependencies
        run: npm ci

      - name: Generate iOS project if missing
        run: |
          if [ ! -d ios ]; then
            npx expo prebuild --platform ios --no-install
          fi

      - name: Install CocoaPods
        run: |
          if [ -f Gemfile ]; then
            bundle install
            cd ios
            bundle exec pod install
          else
            cd ios
            pod install
          fi

      - name: List available Xcode projects
        run: |
          find ios -maxdepth 1 -type d \( -name '*.xcworkspace' -o -name '*.xcodeproj' \)
          test -d "$WORKSPACE"
          xcodebuild -list -workspace "$WORKSPACE"

      - name: Build Release for physical iOS devices
        run: |
          set -euo pipefail
          mkdir -p logs
          xcodebuild \
            -workspace "$WORKSPACE" \
            -scheme "$SCHEME" \
            -configuration Release \
            -sdk iphoneos \
            -destination 'generic/platform=iOS' \
            -derivedDataPath build \
            CODE_SIGNING_ALLOWED=NO \
            CODE_SIGNING_REQUIRED=NO \
            build 2>&1 | tee logs/xcodebuild.log

      - name: Package unsigned IPA
        run: |
          set -euo pipefail
          PRODUCTS="build/Build/Products/Release-iphoneos"
          test -d "$PRODUCTS"
          APP_PATH=$(find "$PRODUCTS" -maxdepth 1 -type d -name '*.app' -print -quit)

          if [ -z "$APP_PATH" ]; then
            echo 'No device .app found in Release-iphoneos.'
            exit 1
          fi

          test -f "$APP_PATH/Info.plist"
          rm -rf output
          mkdir -p output/Payload
          ditto "$APP_PATH" "output/Payload/$(basename "$APP_PATH")"

          cd output
          zip -qry App-unsigned.ipa Payload
          unzip -t App-unsigned.ipa

      - name: Upload IPA
        uses: actions/upload-artifact@v4
        with:
          name: ios-unsigned-${{ github.run_number }}
          path: output/App-unsigned.ipa
          if-no-files-found: error
          retention-days: 7

      - name: Upload Xcode build log
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ios-build-log-${{ github.run_number }}
          path: logs/xcodebuild.log
          if-no-files-found: ignore
          retention-days: 7
```

### Điều chỉnh theo project

| Trường | Cách chọn |
| --- | --- |
| `workspace` | Đường dẫn `.xcworkspace` ngay dưới `ios`, không chọn workspace bên trong `.xcodeproj` |
| `scheme` | Scheme của app chính, được chia sẻ để CI nhìn thấy |
| `node-version` | Phiên bản Node tương thích với Expo SDK |
| `runs-on` | macOS runner có Xcode phù hợp |
| `timeout-minutes` | Tăng nếu app lớn và giới hạn tài khoản cho phép |

Nếu có nhiều app target, bước đóng gói tự lấy `.app` đầu tiên có thể chọn sai app. Khi đó thay dòng tìm `APP_PATH` bằng đường dẫn chính xác, ví dụ `APP_PATH="$PRODUCTS/Metus.app"`.

Nếu project dùng Ruby/CocoaPods qua Gemfile, nên khóa phiên bản bằng `Gemfile.lock`. Nếu yêu cầu phiên bản Ruby khác runner, thêm bước cài Ruby tương thích trước `bundle install`. Nếu Gemfile nằm trong `ios/`, điều chỉnh bước CocoaPods cho đúng vị trí.

Workflow minh họa dùng major tag cho GitHub Actions. Với repository cần kiểm soát chuỗi cung ứng chặt hơn, pin action vào commit SHA đã kiểm tra.

## 7. Đẩy code từ Windows

Nếu project chưa được quản lý bằng Git:

```powershell
git init
git add .
git commit -m "Add iOS build workflow"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

Thay URL bằng repository của bạn. Nếu đã có repository và remote, chỉ commit/push thay đổi; không khởi tạo hoặc thêm remote lần nữa.

Trước khi commit, kiểm tra `.gitignore`: không đưa `node_modules`, file build, mật khẩu, chứng chỉ hoặc file môi trường chứa bí mật vào Git. Kiểm tra cả các file đã được Git theo dõi vì thêm `.gitignore` không tự loại chúng khỏi lịch sử.

## 8. Chạy build và tải IPA

1. Mở repository trên GitHub.
2. Vào tab **Actions**.
3. Chọn **Build unsigned iOS IPA**.
4. Bấm **Run workflow**.
5. Nhập workspace và scheme đúng với app.
6. Chọn branch rồi bấm chạy.
7. Khi job thành công, mở trang lần chạy đó.
8. Tại **Artifacts**, tải `ios-unsigned-<số lần chạy>`.
9. Giải nén ZIP để lấy `App-unsigned.ipa`.

Nếu chưa thấy nút chạy, kiểm tra workflow đã có trên default branch và Actions được bật. Nếu build thất bại, đọc step màu đỏ; log Xcode riêng chỉ xuất hiện khi bước Xcode đã bắt đầu.

Mỗi lần chạy dùng mã nguồn của branch được chọn tại thời điểm chạy. Đã sửa code trên Windows thì cần commit và push trước khi build lại.

## 9. Ký bằng ESign

1. Chuyển `App-unsigned.ipa` sang iPhone hoặc phương thức nhập file bạn đang dùng.
2. Nhập chứng chỉ `.p12` và provisioning profile phù hợp vào ESign.
3. Nhập IPA, chọn bộ chứng chỉ rồi thực hiện ký.
4. Cài bản đã ký lên thiết bị được profile cho phép.

Tên nút và thao tác có thể khác theo phiên bản ESign. Build thành công không đảm bảo việc ký hoặc cài thành công: còn phụ thuộc chứng chỉ còn hiệu lực, Bundle ID, entitlement, loại phân phối và điều kiện thiết bị của profile.

Ứng dụng có extension cần ký cả các thành phần lồng nhau với profile/quyền tương ứng. Không phải tính năng nào cũng hoạt động chỉ bằng cách đổi Bundle ID khi ký lại, đặc biệt Push Notifications, App Groups và iCloud.

Không đổi phần mở rộng `.app` thành `.ipa`. IPA là ZIP có thư mục `Payload` chứa gói `.app`; bước đóng gói trong workflow đã tạo cấu trúc này. Đóng gói chưa ký không thay thế quy trình export bản phân phối đã ký của Xcode.

## 10. Release và kết nối Metro

Workflow dùng `-configuration Release` để React Native đóng gói JavaScript vào app qua build phase của project. Với project tiêu chuẩn, bản Release hoạt động mà không cần máy Windows chạy Metro.

Nếu app vẫn yêu cầu development server, kiểm tra bạn đã cài đúng IPA Release mới nhất, build phase bundle JavaScript không bị vô hiệu hóa, và cấu hình `expo-dev-client` / `expo-updates` không hướng app sang luồng phát triển ngoài ý muốn. Không đặt `SKIP_BUNDLING=1` cho bản cần chạy độc lập.

## 11. Biến môi trường và API

Nếu cấu hình app cần biến môi trường, khai báo chúng trong GitHub **Settings → Secrets and variables → Actions**, sau đó tham chiếu trong `env` của job hoặc step:

```yaml
env:
  CI: "1"
  WORKSPACE: ${{ inputs.workspace }}
  SCHEME: ${{ inputs.scheme }}
  EXPO_PUBLIC_API_URL: ${{ vars.EXPO_PUBLIC_API_URL }}
```

Đây là ví dụ thay cho khối `env` hiện tại, không tạo hai khóa `env` cùng cấp. GitHub Actions không tự nhận biến được cấu hình riêng trong EAS.

Biến `EXPO_PUBLIC_*` được đưa vào ứng dụng và có thể bị đọc từ bản build. Chỉ dùng chúng cho dữ liệu công khai như URL API; giữ khóa bí mật ở backend. GitHub Secret cũng không còn bí mật nếu bạn nhúng giá trị của nó vào mã ứng dụng phía client.

## 12. Lỗi thường gặp

| Lỗi / hiện tượng | Kiểm tra và xử lý |
| --- | --- |
| `npm ci` thất bại | Kiểm tra `package-lock.json` có tồn tại và khớp `package.json`; sửa dependency rồi commit lockfile |
| Workspace không tồn tại | Xem danh sách thư mục ở step Xcode; sửa input `workspace`; kiểm tra Prebuild và Pods đã thành công |
| Scheme không tồn tại | Xem kết quả `xcodebuild -list`; nhập đúng scheme ứng dụng và bảo đảm scheme được chia sẻ |
| `pod install` thất bại | Đọc lỗi gốc; kiểm tra Ruby, CocoaPods, deployment target và native module; chỉ dùng `--repo-update` khi lỗi thật sự do spec repo cũ |
| SDK / Swift / Xcode không tương thích | Chọn runner hoặc Xcode phù hợp với phiên bản Expo và native dependency |
| Xcode yêu cầu signing | Kiểm tra cờ tắt signing, target phụ và script tùy chỉnh; một số project cần sửa cấu hình native |
| Không tìm thấy `.app` | Kiểm tra scheme có build app target, cấu hình Release và thư mục output tùy chỉnh |
| `xcodebuild` exit code 65 | Đây là mã lỗi tổng quát; tìm lỗi biên dịch đầu tiên trong log, không kết luận ngay là lỗi chứng chỉ |
| Bundle JavaScript thất bại | Kiểm tra import, khác biệt chữ hoa/thường, asset thiếu, biến môi trường và cấu hình Metro |
| IPA cài không được | Kiểm tra bước ký, profile, thiết bị được phép, entitlement và chứng chỉ còn hiệu lực |
| App mở rồi thoát | Xem crash log thiết bị; kiểm tra thư viện native, signing, quyền riêng tư trong Info.plist và cấu hình Release |
| Job dừng vì giới hạn Actions | Kiểm tra usage, billing, timeout và chính sách tổ chức |

Không xóa lockfile hoặc chạy Prebuild clean như cách sửa mọi lỗi. Mỗi thao tác này có thể làm thay đổi dependency hoặc mất chỉnh sửa native.

## 13. Nếu dùng Yarn, pnpm hoặc monorepo

Workflow trên chỉ hỗ trợ npm ở root theo mặc định.

- Yarn: thay bước cài bằng lệnh bất biến phù hợp với phiên bản Yarn, đổi cache và commit lockfile tương ứng.
- pnpm: cài đúng phiên bản pnpm trước bước cache/cài dependency, dùng `pnpm install --frozen-lockfile` và điều chỉnh lệnh Expo.
- Monorepo: cài dependency ở đúng workspace root; đặt working directory và đường dẫn `ios`, file log, artifact theo vị trí app. Không chỉ thêm một `cd` rồi giữ nguyên toàn bộ đường dẫn.
- Bare React Native: giữ project `ios` hiện có; không thêm Expo Prebuild nếu app không dùng Expo CNG. Sửa bước dependency và CocoaPods theo project.

## 14. TestFlight và App Store

Workflow này chỉ tạo gói chưa ký để ký lại. Muốn đưa lên TestFlight cần một quy trình khác: Apple Developer Program, app trên App Store Connect, Bundle ID và quyền phù hợp, cấu hình ký bản phân phối, archive/export và xác thực upload.

IPA ký để cài nội bộ không tự động trở thành bản hợp lệ cho TestFlight. Với Expo, có thể chọn EAS Build/EAS Submit hoặc cấu hình pipeline Xcode/fastlane riêng.

## 15. Chi phí và giới hạn

Thời gian build phụ thuộc dependency, dung lượng project, cache và hàng đợi; không có thời gian cố định cho mọi app. Mức miễn phí và chi phí GitHub Actions phụ thuộc loại repository, runner và gói tài khoản. Kiểm tra trang giá và usage trước khi chạy nhiều lần; không mặc định macOS runner luôn miễn phí.

Artifact trong mẫu được yêu cầu giữ 7 ngày, chịu giới hạn retention của repository/tổ chức. Tải IPA về trước khi artifact hết hạn hoặc bị xóa.

## 16. Danh sách kiểm tra trước lần chạy đầu

- [ ] Mã nguồn đã được push lên GitHub.
- [ ] Workflow nằm đúng `.github/workflows/build-ios.yml`.
- [ ] Dùng npm và có `package-lock.json`, hoặc đã chuyển workflow sang package manager thực tế.
- [ ] Bundle ID đúng và asset/config plugin đầy đủ.
- [ ] Workspace và scheme đúng tên app chính.
- [ ] Node và Xcode phù hợp với Expo SDK.
- [ ] Biến môi trường cần cho CI đã được cấu hình.
- [ ] Hiểu rằng IPA đầu ra chưa ký và cần bộ chứng chỉ/profile phù hợp để cài.

## 17. Tài liệu chính thức

- [Expo Continuous Native Generation và Prebuild](https://docs.expo.dev/workflow/continuous-native-generation/)
- [Expo CLI](https://docs.expo.dev/more/expo-cli/)
- [Quy trình build iOS của EAS — tham khảo các bước native](https://docs.expo.dev/build-reference/ios-builds/)
- [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub upload-artifact](https://github.com/actions/upload-artifact)
- [Giá GitHub Actions](https://github.com/pricing)

Tài liệu được soạn cho quy trình build từ Windows qua GitHub Actions. Cần chạy thực tế trên repository của bạn để xác nhận tương thích; chưa có mã nguồn app để kiểm chứng toàn bộ build và việc cài bằng ESign.
