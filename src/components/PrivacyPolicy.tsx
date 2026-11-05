import { PRIVACY_URL, PRIVACY_VERSION, SUPPORT_EMAIL } from '../lib/compliance';

export function PrivacyPolicy() {
  return (
    <div className="privacy-content">
      <p className="privacy-updated">
        生效日期：2026-11-05 · 政策版本 {PRIVACY_VERSION}
      </p>

      <p className="privacy-lead">
        薪时是一款不登录、不上传的本地记工工具。这份政策说明我们如何处理你的信息，
        以及你随时可以怎样删除它。
      </p>

      <section>
        <h3>1. 我们收集什么</h3>
        <p>
          薪时<strong>不收集、不上传</strong>你的个人信息。你主动录入的称呼、工作名称、
          工时、薪资、借支、休息与结算记录，只保存在这台设备的本地存储里。
        </p>
        <p>
          应用没有账号体系，不需要手机号、邮箱、身份证或位置信息；没有广告、统计、
          追踪或用户画像。
        </p>
      </section>

      <section>
        <h3>2. 数据存在哪里</h3>
        <ul>
          <li>账本数据：设备本地 localStorage；本机快照：设备本地 IndexedDB。</li>
          <li>
            你主动导出的备份、搬家包、工资条、PDF、Excel 和 CSV：写到系统下载目录
            Download/Xinshi/ 或你选择的位置，由你保管。
          </li>
          <li>
            Android 版不申请网络权限，应用内没有上传接口；网页版只加载自身静态资源，
            不会把账本数据发到服务器。
          </li>
          <li>
            「自动备份」默认关闭。开启后，每天首次打开 App 时把一份未加密的普通备份写入
            Download/Xinshi/自动备份/，保留最近 14 份；可随时关闭。
          </li>
        </ul>
      </section>

      <section>
        <h3>3. 权限与用途</h3>
        <ul>
          <li>
            <strong>通知（可选）</strong>：用于每日记工提醒和发薪提醒；拒绝后仍可正常记工。
          </li>
          <li>
            <strong>开机恢复通知</strong>：设备重启后重新安排本地提醒，不读取任何内容。
          </li>
          <li>
            不申请存储、相机、位置、通讯录、电话或短信权限。导出文件通过系统媒体库写入
            应用自己的下载目录，不需要存储权限。
          </li>
          <li>Android 版不申请精确闹钟权限。</li>
        </ul>
      </section>

      <section>
        <h3>4. 共享、第三方与广告</h3>
        <p>
          我们不向任何第三方出售、出租或共享你的数据。应用内没有广告、统计 SDK、
          推送服务或云同步服务。二维码、PDF、图表、图标等库都在本地运行。
        </p>
        <p>
          只有你主动把备份、搬家包、工资条或二维码发给别人时，数据才会离开这台设备；
          发送范围由你决定。
        </p>
      </section>

      <section>
        <h3>5. 删除你的数据</h3>
        <ul>
          <li>应用内「我的 → 数据与安全 → 清空所有数据」会删除工作、工记、休息、借支和结算。</li>
          <li>卸载 App 会删除应用本地数据；系统可能保留应用缓存，可在系统设置中清除。</li>
          <li>已经导出的文件不在应用控制范围内，请自行在文件管理器中删除。</li>
          <li>本机快照可以在「本机时光机」里逐条删除或一次清空。</li>
          <li>因为没有账号，所以没有「注销账号」流程；删除数据即完成删除。</li>
        </ul>
      </section>

      <section>
        <h3>6. 儿童与未成年人</h3>
        <p>
          薪时面向有劳动收入记录的成年人，不面向儿童设计，也不会主动收集未成年人的信息。
        </p>
      </section>

      <section>
        <h3>7. 安全说明</h3>
        <p>
          工资数据属于敏感信息。我们提供 AES-GCM 加密的备份 / 搬家包密码保护；
          密码不会保存，忘记后无法恢复加密文件。自动备份默认关闭，开启后为明文文件，
          请注意手机文件可能被其他应用读取。
        </p>
      </section>

      <section>
        <h3>8. 政策更新与联系</h3>
        <p>
          政策更新会在应用内提示重新确认，并更新本页顶部的版本号。若你对隐私有疑问，
          可联系：<a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>。
        </p>
        <p className="privacy-url">
          在线版本：<span className="privacy-url-text">{PRIVACY_URL}</span>
        </p>
      </section>

      <p className="privacy-foot">
        薪时 XINSHI · 个人记工工具。计算结果仅供参考，不构成劳动、税务或法律意见。
      </p>
    </div>
  );
}
