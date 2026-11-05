/**
 * 构建期空模块。
 * jsPDF 的 html() 能力会动态引用 html2canvas，但薪时只用文字 PDF / Canvas 工资条，
 * 用 alias 把它换成空模块，避免把 200KB 的 html2canvas 打进包里。
 */
const empty = {};
export default empty;
